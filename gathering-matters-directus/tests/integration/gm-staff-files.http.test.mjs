import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Authenticated staff scan-upload route: POST /gm-intake/staff-files.
// Env-driven so it can run against a disposable Directus (flag ON) with a
// throwaway Postgres. Skips when not configured.
const BASE = String(process.env.GM_STAFF_BASE_URL || process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const ADMIN = process.env.GM_STAFF_ADMIN_TOKEN || '';
const ROLE_TOKEN = process.env.GM_STAFF_ROLE_TOKEN || '';       // allowlisted staff role
const UNLISTED_TOKEN = process.env.GM_STAFF_UNLISTED_TOKEN || ''; // authenticated, not allowlisted
const DB_URL = process.env.TEST_DATABASE_URL || '';
const PENDING_FOLDER = process.env.GM_STAFF_PENDING_FOLDER_ID || '';
const LIVE = Boolean(BASE && ADMIN);
const skip = LIVE ? {} : { skip: 'set GM_STAFF_BASE_URL and GM_STAFF_ADMIN_TOKEN' };

const TXT = Buffer.from('Gathering Matters staff scan-upload integration test. No PII or malicious content.\n');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ

async function post(token, { name = 'doc.txt', mime = 'text/plain', buffer = TXT, submission_id } = {}) {
  const form = new FormData();
  if (submission_id) form.append('submission_id', submission_id);
  form.append('attachments', new Blob([buffer], { type: mime }), name);
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}/gm-intake/staff-files`, { method: 'POST', headers, body: form });
  let body = null; try { body = await res.json(); } catch {}
  return { res, body };
}
function assertNoLeak(body) {
  const t = JSON.stringify(body || {}).toLowerCase();
  for (const f of ['filename_disk', 'object_key', 'etag', 'version', 'bucket', 'storage', 'signedurl', 'accesskey']) {
    assert.equal(t.includes(f.toLowerCase()), false, `staff response leaked ${f}`);
  }
}

test('anonymous is denied (403), nothing created', skip, async () => {
  const { res } = await post(null);
  assert.equal(res.status, 403);
});

test('authenticated but unlisted role is denied (403)', { skip: skip.skip || !UNLISTED_TOKEN ? 'no unlisted token' : undefined }, async () => {
  const { res } = await post(UNLISTED_TOKEN);
  assert.equal(res.status, 403);
});

test('admin uploads a valid TXT -> 201, one STAFF_MANAGED PENDING file_scan in Pending folder', skip, async () => {
  const { res, body } = await post(ADMIN, { name: 'gm-staff-clean.txt' });
  assert.equal(res.status, 201);
  assert.equal(body.data.scan_state, 'PENDING');
  assertNoLeak(body);
  const fileId = body.data.file_id;
  assert.ok(fileId);
  if (DB_URL) {
    const db = new pg.Client({ connectionString: DB_URL }); await db.connect();
    try {
      const f = (await db.query('SELECT folder, storage, filename_disk FROM directus_files WHERE id=$1', [fileId])).rows;
      assert.equal(f.length, 1);
      if (PENDING_FOLDER) assert.equal(f[0].folder, PENDING_FOLDER);
      const s = (await db.query('SELECT origin, scan_status, object_key FROM file_scan WHERE directus_file_id=$1', [fileId])).rows;
      assert.equal(s.length, 1, 'exactly one file_scan row');
      assert.equal(s[0].origin, 'STAFF_MANAGED');
      assert.equal(s[0].scan_status, 'PENDING');
      assert.equal(s[0].object_key, f[0].filename_disk); // local: object_key == filename_disk
    } finally { await db.end(); }
  }
});

test('allowlisted staff role can upload (201)', { skip: skip.skip || !ROLE_TOKEN ? 'no role token' : undefined }, async () => {
  const { res, body } = await post(ROLE_TOKEN, { name: 'gm-staff-role.txt' });
  assert.equal(res.status, 201);
  assert.equal(body.data.scan_state, 'PENDING');
});

test('PDF is accepted', skip, async () => {
  const { res } = await post(ADMIN, { name: 'd.pdf', mime: 'application/pdf', buffer: PDF });
  assert.equal(res.status, 201);
});

for (const [label, opts, status] of [
  ['image', { name: 'x.png', mime: 'image/png', buffer: PNG }, 422],
  ['csv', { name: 'x.csv', mime: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') }, 422],
  ['executable renamed .txt', { name: 'x.txt', mime: 'text/plain', buffer: EXE }, 422],
  ['mime/extension mismatch', { name: 'x.pdf', mime: 'application/pdf', buffer: TXT }, 422],
  ['empty file', { name: 'x.txt', mime: 'text/plain', buffer: Buffer.alloc(0) }, 422],
]) {
  test(`rejects ${label}`, skip, async () => {
    const { res } = await post(ADMIN, opts);
    assert.equal(res.status, status);
  });
}

test('rejects a second file (single-file route)', skip, async () => {
  const form = new FormData();
  form.append('attachments', new Blob([TXT], { type: 'text/plain' }), 'a.txt');
  form.append('attachments', new Blob([TXT], { type: 'text/plain' }), 'b.txt');
  const res = await fetch(`${BASE}/gm-intake/staff-files`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: form });
  assert.equal(res.status, 422);
});

test('a non-canonical (v4) submission_id is rejected (422)', skip, async () => {
  const { res } = await post(ADMIN, { submission_id: '00000000-0000-4000-8000-000000000000' });
  assert.equal(res.status, 422);
});

test('a canonical but nonexistent submission_id is rejected (422)', skip, async () => {
  const { res } = await post(ADMIN, { submission_id: '018f2e6a-7b3c-7def-8a1b-0123456789ab' });
  assert.equal(res.status, 422);
});
