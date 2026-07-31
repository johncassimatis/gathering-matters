import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const RUN_ID = process.env.GM_INTEGRATION_RUN_ID || crypto.randomUUID();
const DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const LIVE = Boolean(BASE && DATABASE_URL);
const skip = LIVE ? {} : { skip: 'set GM_INTEGRATION_BASE_URL and TEST_DATABASE_URL' };
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SAFE_RESPONSE_KEYS = ['filename_disk', 'storage', 'object_key', 'object_version_id', 'etag', 'bucket', 'download_url'];

let db;
let sequence = 0;

function unique(prefix) {
  sequence += 1;
  return `${prefix}-${RUN_ID}-${sequence}`;
}

function fields(source = 'listening_program') {
  return {
    source,
    title: unique('HTTP intake'),
    body: 'This is a valid integration-test submission body with enough characters.',
    submitter_name: 'Integration Test',
    submitter_email: `${unique('intake').toLowerCase()}@test.invalid`,
    consent_to_review: 'true',
    consent_to_contact: 'true',
    consent_to_updates: 'false',
    ...(source === 'young_adult_initiative' ? { preferred_follow_up: 'email', submitter_age_range: '18_24' } : {}),
  };
}

function headers() {
  sequence += 1;
  const runOctet = crypto.createHash('sha256').update(RUN_ID).digest()[0];
  return {
    'x-gm-test-run-id': RUN_ID,
    'x-forwarded-for': `198.51.100.${((runOctet + sequence) % 250) + 1}`,
  };
}

async function postJson(payload, extraHeaders = {}) {
  return fetch(`${BASE}/gm-intake/submissions`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  });
}

async function postFiles(fileEntries, textFields = fields(), extraHeaders = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(textFields)) form.append(key, String(value));
  for (const file of fileEntries) form.append('attachments', new Blob([file.bytes], { type: file.mime }), file.name);
  return fetch(`${BASE}/gm-intake/submissions`, { method: 'POST', headers: { ...headers(), ...extraHeaders }, body: form });
}

async function json(response) {
  const body = await response.json();
  return body;
}

function assertNoStorageLeak(body) {
  const text = JSON.stringify(body);
  for (const key of SAFE_RESPONSE_KEYS) assert.equal(text.includes(`"${key}"`), false, `response leaked ${key}`);
  assert.equal(text.includes('attachment_id'), false);
  assert.equal(text.includes('file_id'), false);
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data || 'x');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([localHeader, name, data]);
    locals.push(local);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([centralHeader, name]));
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function makeCentralDirectoryZip(entries) {
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt32LE(entry.compressed ?? 1, 20);
    header.writeUInt32LE(entry.uncompressed ?? 1, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name]));
    offset += 30 + name.length + (entry.compressed ?? 1);
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(4, 16);
  return Buffer.concat([Buffer.from('PK\x03\x04'), directory, eocd]);
}

const pdf = Buffer.from('%PDF-1.7\nvalid integration fixture');
const txt = Buffer.from('plain text integration fixture');
const docx = makeZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'word/document.xml', data: '<w/>' }]);
const pptx = makeZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'ppt/presentation.xml', data: '<p/>' }]);
const xlsx = makeZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'xl/workbook.xml', data: '<w/>' }]);

async function count(table, predicate = '') {
  const suffix = predicate ? ` WHERE ${predicate}` : '';
  const result = await db.query(`SELECT count(*)::int AS count FROM ${table}${suffix}`);
  return result.rows[0].count;
}

before(async () => {
  if (!LIVE) return;
  db = new Client({ connectionString: DATABASE_URL, ssl: process.env.TEST_DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await db.connect();
});

after(async () => { if (db) await db.end(); });

test('JSON submission preserves the existing 201 response contract', skip, async () => {
  const response = await postJson(fields());
  const body = await json(response);
  assert.equal(response.status, 201);
  assert.equal(body.data.status, 'pending');
  assert.equal(body.data.attachment_count, 0);
  assert.equal(typeof body.data.id, 'string');
  assertNoStorageLeak(body);
});

test('YAI requires contact consent and follow-up, then stores a pending submission', skip, async () => {
  const invalid = await postJson({ ...fields('young_adult_initiative'), consent_to_contact: 'false' });
  assert.equal(invalid.status, 422);
  const response = await postJson(fields('young_adult_initiative'));
  const body = await json(response);
  assert.equal(response.status, 201);
  assert.equal(body.data.status, 'pending');
  assert.equal(await count('submission', `source = 'young_adult_initiative' AND status = 'pending'` ) > 0, true);
});

for (const file of [
  { name: 'valid.pdf', mime: 'application/pdf', bytes: pdf },
  { name: 'valid.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx },
  { name: 'valid.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: pptx },
  { name: 'valid.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: xlsx },
  { name: 'valid.txt', mime: 'text/plain', bytes: txt },
]) {
  test(`accepts ${file.name} over the real multipart HTTP route and records PENDING scan state`, skip, async () => {
    const response = await postFiles([file]);
    const body = await json(response);
    assert.equal(response.status, 201);
    assert.equal(body.data.status, 'pending');
    assert.equal(body.data.attachment_count, 1);
    assertNoStorageLeak(body);
    const row = await db.query(`SELECT sf.submission_id, fs.origin, fs.scan_status
      FROM submission_file sf JOIN file_scan fs ON fs.directus_file_id = sf.directus_file_id
      WHERE sf.submission_id = $1`, [body.data.id]);
    assert.equal(row.rows.length, 1);
    assert.deepEqual(row.rows[0], { submission_id: body.data.id, origin: 'PUBLIC_SUBMISSION', scan_status: 'PENDING' });
  });
}

const rejected = [
  ['image', 'image.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
  ['csv', 'rows.csv', 'text/csv', Buffer.from('a,b,c\n1,2,3')],
  ['legacy Office', 'old.doc', 'application/msword', Buffer.from('legacy')],
  ['macro Office', 'active.docm', 'application/vnd.ms-word.document.macroEnabled.12', docx],
  ['archive', 'archive.zip', 'application/zip', makeZip([{ name: 'payload', data: 'x' }])],
  ['script', 'script.js', 'text/javascript', Buffer.from('alert(1)')],
  ['HTML', 'page.html', 'text/html', Buffer.from('<html><script>x</script></html>')],
  ['renamed executable', 'payload.pdf', 'application/pdf', Buffer.from('MZ\x90\x00')],
  ['malformed OOXML', 'broken.docx', 'application/octet-stream', Buffer.from('PK\x03\x04not-a-package')],
  ['empty file', 'empty.txt', 'text/plain', Buffer.alloc(0)],
];
for (const [label, name, mime, bytes] of rejected) {
  test(`rejects ${label} through HTTP without creating a submission`, skip, async () => {
    const before = await count('submission');
    const response = await postFiles([{ name, mime, bytes }]);
    assert.equal(response.status, 422);
    assert.equal(await count('submission'), before);
    assertNoStorageLeak(await json(response));
  });
}

test('rejects MIME, extension, and signature mismatches', skip, async () => {
  for (const file of [
    { name: 'mismatch.pdf', mime: 'text/plain', bytes: pdf },
    { name: 'mismatch.pdf', mime: 'application/pdf', bytes: docx },
    { name: 'mismatch.docx', mime: 'application/octet-stream', bytes: pdf },
  ]) {
    const response = await postFiles([file]);
    assert.equal(response.status, 422);
  }
});

test('rejects OOXML entry-count, expanded-size, and compression-ratio limits', skip, async () => {
  const tooMany = makeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `entry-${i}.xml`, data: 'x' })));
  const expanded = makeCentralDirectoryZip([
    { name: '[Content_Types].xml', compressed: 1, uncompressed: 400 * 1024 * 1024 },
    { name: 'word/document.xml', compressed: 1, uncompressed: 1 },
  ]);
  const ratio = makeCentralDirectoryZip([
    { name: '[Content_Types].xml', compressed: 1, uncompressed: 1000 },
    { name: 'word/document.xml', compressed: 1, uncompressed: 1 },
  ]);
  for (const bytes of [tooMany, expanded, ratio]) {
    const response = await postFiles([{ name: 'bad.docx', mime: 'application/octet-stream', bytes }]);
    assert.equal(response.status, 422);
  }
});

test('enforces five-file count and accepts multiple files within policy', skip, async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `file-${i}.txt`, mime: 'text/plain', bytes: txt }));
  assert.equal((await postFiles(six)).status, 422);
  const response = await postFiles(six.slice(0, 2));
  assert.equal(response.status, 201);
  assert.equal((await json(response)).data.attachment_count, 2);
});

test('busboy file-size limit returns 413 for an oversized stream', skip, async () => {
  const bytes = Buffer.alloc(MAX_FILE_BYTES + 1, 0x61);
  const response = await postFiles([{ name: 'large.txt', mime: 'text/plain', bytes }]);
  assert.equal(response.status, 413);
});

test('test-only HTTP fault injection rolls back associations and never returns a downloadable UUID', skip, async () => {
  for (const stage of ['files_upload', 'submission_insert', 'submission_insert_after', 'submission_file_insert', 'file_scan_insert', 'cleanup']) {
    const before = await count('submission');
    const response = await postFiles([{ name: `${stage}.pdf`, mime: 'application/pdf', bytes: pdf }], fields(), { 'x-gm-test-failure': stage });
    assert.equal(response.status >= 400, true, `failure injection did not fail: ${stage}`);
    assert.equal(await count('submission'), before);
    assertNoStorageLeak(await json(response));
  }
});

test('client abort does not create a misleading submission association', { ...skip, timeout: 10000 }, async () => {
  const before = await count('submission');
  const body = `--abort-boundary\r\nContent-Disposition: form-data; name="source"\r\n\r\nlistening_program\r\n--abort-boundary\r\nContent-Disposition: form-data; name="attachments"; filename="partial.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-`;
  const controller = new AbortController();
  const request = fetch(`${BASE}/gm-intake/submissions`, { method: 'POST', headers: { ...headers(), 'content-type': 'multipart/form-data; boundary=abort-boundary' }, body, signal: controller.signal });
  controller.abort();
  await assert.rejects(request);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await count('submission'), before);
});

test('multipart attachments are unavailable when the feature is disabled', { skip: process.env.GM_EXPECT_UPLOADS_DISABLED !== 'true' }, async () => {
  const response = await postFiles([{ name: 'disabled.pdf', mime: 'application/pdf', bytes: pdf }]);
  assert.notEqual(response.status, 201);
  assertNoStorageLeak(await json(response));
});
