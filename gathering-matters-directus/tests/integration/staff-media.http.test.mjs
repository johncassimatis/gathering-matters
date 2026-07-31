import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.GM_STAFF_MEDIA_TOKEN || '';
const LIVE = Boolean(BASE && TOKEN && process.env.TEST_DATABASE_URL);
const skip = LIVE ? {} : { skip: 'set GM_STAFF_MEDIA_TOKEN and disposable database settings' };
let db;

test('staff image workflow remains separate from public document scan records', skip, async () => {
  db = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: process.env.TEST_DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  await db.connect();
  const form = new FormData();
  form.append('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'staff-image.png');
  const response = await fetch(`${BASE}/files`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  assert.equal(response.status, 200);
  const body = await response.json();
  const fileId = body.data.id;
  const scans = await db.query('SELECT origin FROM file_scan WHERE directus_file_id = $1', [fileId]);
  assert.equal(scans.rows.length, 0);
});

test('public-submitted documents cannot be used as featured images', { skip: skip.skip || !process.env.GM_PUBLIC_DOCUMENT_ID ? 'missing public-document fixture' : undefined }, async () => {
  const response = await fetch(`${BASE}/items/content_item/${process.env.GM_PUBLIC_DOCUMENT_ID}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ featured_image_id: process.env.GM_PUBLIC_DOCUMENT_FILE_ID }),
  });
  assert.notEqual(response.status, 200);
});

test('file_scan origin is immutable', { skip: skip.skip || !process.env.GM_PUBLIC_FILE_SCAN_ID ? 'missing scan fixture' : undefined }, async () => {
  await assert.rejects(
    db.query('UPDATE file_scan SET origin = $1 WHERE id = $2', ['STAFF_MANAGED', process.env.GM_PUBLIC_FILE_SCAN_ID]),
    /immutable/,
  );
});

after(async () => { if (db) await db.end(); });
