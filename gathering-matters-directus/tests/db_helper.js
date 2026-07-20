import pg from 'pg';
import fs from 'fs';
import toml from 'toml';
import path from 'path';

export async function getDbClient() {
  const tomlPath = path.resolve(process.cwd(), '../gathering-matters-db/flyway.user.toml');
  const tomlFile = fs.readFileSync(tomlPath, 'utf-8');
  const config = toml.parse(tomlFile);

  const personalEnv = config.environments?.personal;
  if (!personalEnv) throw new Error("Could not find [environments.personal] in flyway.toml");

  let cleanUrl = personalEnv.url.replace(/^jdbc:/, '');
  const dbUrlObj = new URL(cleanUrl);
  if (personalEnv.user) dbUrlObj.username = personalEnv.user;
  if (personalEnv.password) dbUrlObj.password = encodeURIComponent(personalEnv.password);

  const client = new pg.Client({
    connectionString: dbUrlObj.toString(),
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  return client;
}