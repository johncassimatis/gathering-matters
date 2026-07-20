import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

// Local runs load the ignored .env.test file. Render/CI environment variables
// remain authoritative because dotenv does not override existing variables.
dotenv.config({ path: process.env.TEST_ENV_FILE || '.env.test', quiet: true });

import { getDbClient } from './db_helper.js';
import { testFixtures } from './fixtures.js';
import { seedDatabase } from './seed.js';
import { cleanupTestData } from './cleanup.js';
import { recordTestRun } from './audit.js';

function runVitest() {
  const vitestEntry = path.resolve('node_modules/vitest/vitest.mjs');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitestEntry, 'run'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', (error) => resolve({ code: 1, error }));
    child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function waitForApi() {
  // /server/health is permission-protected in this deployment. /server/ping
  // is the public liveness endpoint; the database connection is verified
  // separately before this check.
  const healthUrl = `${process.env.API_URL || 'http://localhost:8055'}/server/ping`;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Directus did not become healthy at ${healthUrl}`);
}

const runId = process.env.TEST_RUN_ID || crypto.randomUUID();
process.env.TEST_RUN_ID = runId;
const fixtures = testFixtures();
let client;
let exitCode = 1;

try {
  client = await getDbClient();

  const identity = await client.query(
    `SELECT current_user,
            has_table_privilege(current_user, 'public.test_run_audit', 'INSERT') AS can_audit,
            has_table_privilege(current_user, 'public.audit_event', 'DELETE') AS can_delete_workflow_audit`
  );
  if (identity.rows[0].current_user !== (process.env.TEST_DB_USER || identity.rows[0].current_user)) {
    throw new Error(`Unexpected test database role: ${identity.rows[0].current_user}`);
  }
  if (!identity.rows[0].can_audit) throw new Error('Test role cannot write test_run_audit. Apply V006 and provisioning grants.');
  if (identity.rows[0].can_delete_workflow_audit) throw new Error('Test role must not be able to delete audit_event.');

  await recordTestRun(client, runId, 'started', { api_url: process.env.API_URL || 'http://localhost:8055' });
  await waitForApi();
  await seedDatabase(client, fixtures);
  await recordTestRun(client, runId, 'seeded', { content_type_slug: fixtures.contentTypeSlug });

  const result = await runVitest();
  if (result.code === 0) {
    await recordTestRun(client, runId, 'tests_passed');
    exitCode = 0;
  } else {
    await recordTestRun(client, runId, 'tests_failed', { exit_code: result.code, signal: result.signal || null });
  }
} catch (error) {
  console.error(error);
  if (client) {
    try {
      await recordTestRun(client, runId, 'tests_failed', { error: error.message.slice(0, 500) });
    } catch {}
  }
} finally {
  if (client) {
    try {
      await cleanupTestData(client, fixtures);
      await recordTestRun(client, runId, 'cleaned');
    } catch (error) {
      console.error(`Test cleanup failed: ${error.message}`);
      try {
        await recordTestRun(client, runId, 'cleanup_failed', { error: error.message.slice(0, 500) });
      } catch {}
      exitCode = 1;
    }
    await client.end();
  }
}

process.exitCode = exitCode;
