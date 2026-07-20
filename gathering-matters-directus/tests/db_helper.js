import pg from 'pg';

const { Client } = pg;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required test database environment variable: ${name}`);
  return value;
}

export function getDbConfig() {
  const ssl = process.env.TEST_DB_SSL !== 'false'
    ? { rejectUnauthorized: false }
    : false;

  if (process.env.TEST_DATABASE_URL) {
    return { connectionString: process.env.TEST_DATABASE_URL, ssl };
  }

  return {
    host: required('TEST_DB_HOST'),
    port: Number(process.env.TEST_DB_PORT || 5432),
    database: required('TEST_DB_NAME'),
    user: required('TEST_DB_USER'),
    password: required('TEST_DB_PASSWORD'),
    ssl,
  };
}

export async function getDbClient() {
  const client = new Client(getDbConfig());
  await client.connect();
  return client;
}
