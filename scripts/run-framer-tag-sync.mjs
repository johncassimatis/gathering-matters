import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tagSyncDir = resolve(repoRoot, "gathering-matters-directus", "tag-sync");
const envFile = resolve(tagSyncDir, ".env");
const syncScript = resolve(tagSyncDir, "sync.mjs");

const result = spawnSync(
  process.execPath,
  ["--env-file", envFile, syncScript, ...process.argv.slice(2)],
  { cwd: tagSyncDir, stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
