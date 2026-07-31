import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('tests/integration');
const files = (await readdir(root))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(root, name));

const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
