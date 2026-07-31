import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('tests/integration');
const requireDisabled = process.env.GM_REQUIRE_DISABLED === 'true';
const requireMinio = process.env.GM_REQUIRE_MINIO === 'true';
if (requireDisabled && !process.env.GM_DISABLED_INTEGRATION_BASE_URL) throw new Error('GM_REQUIRE_DISABLED=true requires GM_DISABLED_INTEGRATION_BASE_URL');
if (requireMinio && (!process.env.GM_MINIO_FIXTURE_OUTPUT || !process.env.GM_MINIO_ENDPOINT)) throw new Error('GM_REQUIRE_MINIO=true requires MinIO fixture variables');

const files = (await readdir(root))
  .filter((name) => name.endsWith('.test.mjs'))
  .filter((name) => !requireMinio || name === 'gm-library-minio.http.test.mjs')
  .filter((name) => requireDisabled || name !== 'gm-intake-disabled.http.test.mjs')
  .filter((name) => requireMinio || name !== 'gm-library-minio.http.test.mjs')
  .sort()
  .map((name) => path.join(root, name));

const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
