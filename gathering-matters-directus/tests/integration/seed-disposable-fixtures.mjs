import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const OUTPUT = process.env.GM_FIXTURE_OUTPUT || '';
if (!BASE || !DATABASE_URL || !OUTPUT) throw new Error('set GM_INTEGRATION_BASE_URL, TEST_DATABASE_URL, and GM_FIXTURE_OUTPUT');

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { ...options, headers: { ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} ${response.status}: ${text}`);
  return body;
}

const admin = (await request('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.GM_INTEGRATION_ADMIN_EMAIL || 'admin@example.com', password: process.env.GM_INTEGRATION_ADMIN_PASSWORD || 'integration-admin-password' }),
})).data.access_token;

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const typeResult = await db.query('SELECT id FROM content_type WHERE is_active = true ORDER BY id LIMIT 1');
const contentTypeId = typeResult.rows[0]?.id || crypto.randomUUID();
if (!typeResult.rows[0]) {
  await db.query('INSERT INTO content_type (id, name, slug, is_active) VALUES ($1, $2, $3, true)', [contentTypeId, 'Integration Type', 'integration-type']);
}
const adminUserId = (await db.query("SELECT id FROM directus_users WHERE email = 'admin@example.com'")).rows[0].id;

const uploaded = (await (async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('clean disposable attachment\n')], { type: 'text/plain' }), 'clean-disposable.txt');
  return request('/files', { method: 'POST', headers: { authorization: `Bearer ${admin}` }, body: form });
})()).data;

async function cloneFile(id, label) {
  await db.query(`
    INSERT INTO directus_files
      (id, storage, filename_disk, filename_download, title, type, folder, uploaded_by,
       created_on, modified_by, modified_on, charset, filesize, width, height, duration,
       embed, description, location, tags, metadata, focal_point_x, focal_point_y,
       tus_id, tus_data, uploaded_on)
    SELECT $1, storage, filename_disk, $2, title, type, folder, uploaded_by,
       created_on, modified_by, modified_on, charset, filesize, width, height, duration,
       embed, description, location, tags, metadata, focal_point_x, focal_point_y,
       tus_id, tus_data, uploaded_on
    FROM directus_files WHERE id = $3`, [id, `${label}.txt`, uploaded.id]);
}

async function submission(id, fileId, status, scanStatus, source = 'listening_program') {
  await db.query(`
    INSERT INTO submission
      (id, status, date_created, source, title, body, consent, consent_at,
       consent_notice_version, contact_consent, contact_consent_at,
       contact_consent_notice_version, updates_consent, promotion_content_type_id,
       reviewed_by, reviewed_at)
    VALUES ($1, $2, now(), $3, $4, 'Disposable integration body', true, now(),
      'integration', true, now(), 'integration', false, $5,
      CASE WHEN $2 = 'approved' THEN $6::uuid ELSE NULL END,
      CASE WHEN $2 = 'approved' THEN now() ELSE NULL END)`,
  [id, status, source, `Integration ${status} ${id.slice(0, 8)}`, contentTypeId, adminUserId]);
  if (fileId) await db.query('INSERT INTO submission_file (id, submission_id, directus_file_id, label, sort) VALUES ($1, $2, $3, $4, 0)', [crypto.randomUUID(), id, fileId, `${status}.txt`]);
  if (fileId && scanStatus) {
    await db.query(`INSERT INTO file_scan
      (id, directus_file_id, object_key, bucket, object_version_id, etag, origin, scan_status, reason)
      VALUES ($1, $2, 'integration/object', 'disposable', 'v1', 'etag', 'PUBLIC_SUBMISSION', $3, 'integration fixture')`, [crypto.randomUUID(), fileId, scanStatus]);
  }
}

const review = {};
for (const state of ['pending', 'clean', 'threats', 'unsupported', 'failed']) {
  review[state] = { submissionId: crypto.randomUUID(), fileId: crypto.randomUUID() };
  await cloneFile(review[state].fileId, `review-${state}`);
  await submission(review[state].submissionId, review[state].fileId, 'pending', {
    pending: 'PENDING', clean: 'NO_THREATS_FOUND', threats: 'THREATS_FOUND', unsupported: 'UNSUPPORTED', failed: 'FAILED',
  }[state]);
}

const promotion = {};
for (const state of ['approved', 'pending', 'threats', 'unsupported', 'failed', 'clean', 'duplicate', 'yai']) {
  const id = crypto.randomUUID();
  promotion[state] = id;
  if (['approved', 'duplicate'].includes(state)) {
    await submission(id, null, 'approved', null);
  } else {
    const fileId = crypto.randomUUID();
    await cloneFile(fileId, `promotion-${state}`);
    await submission(id, fileId, 'approved', {
      pending: 'PENDING', threats: 'THREATS_FOUND', unsupported: 'UNSUPPORTED', failed: 'FAILED', clean: 'NO_THREATS_FOUND', yai: 'NO_THREATS_FOUND',
    }[state], state === 'yai' ? 'young_adult_initiative' : 'listening_program');
  }
}

const library = {};
for (const state of ['clean', 'unpublished', 'archived', 'future', 'inactive', 'deleted', 'not_download', 'pending', 'threats', 'unsupported', 'access_denied', 'failed', 'missing_scan', 'revoked']) {
  const fileId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const contentId = crypto.randomUUID();
  library[state] = { fileId, submissionId, contentId };
  await cloneFile(fileId, `library-${state}`);
  const scanStatus = {
    clean: 'NO_THREATS_FOUND', future: 'NO_THREATS_FOUND', inactive: 'NO_THREATS_FOUND', deleted: 'NO_THREATS_FOUND',
    not_download: 'NO_THREATS_FOUND', pending: 'PENDING', threats: 'THREATS_FOUND', unsupported: 'UNSUPPORTED',
    access_denied: 'ACCESS_DENIED', failed: 'FAILED', revoked: 'NO_THREATS_FOUND',
  }[state];
  await submission(submissionId, fileId, 'pending', scanStatus);
  const contentStatus = state === 'unpublished' ? 'draft' : state === 'archived' ? 'archived' : 'published';
  const publication = state === 'future' ? "now() + interval '1 day'" : "now() - interval '1 day'";
  await db.query(`INSERT INTO content_item
    (id, status, date_created, title, slug, summary, body, content_type_id, source,
     featured, published_at, privacy_reviewed_at, privacy_reviewed_by)
    VALUES ($1, $2, now(), $3, $4, 'summary', 'body', $5, 'listening_program', false,
      ${publication}, now(), (SELECT id FROM directus_users WHERE email = 'admin@example.com'))`,
  [contentId, contentStatus, `Library ${state}`, `integration-${state}-${contentId.slice(0, 8)}`, contentTypeId]);
  if (!['deleted', 'missing_scan', 'revoked'].includes(state)) {
    await db.query('INSERT INTO content_item_file (id, content_item_id, directus_file_id, label, sort, is_download) VALUES ($1, $2, $3, $4, 0, $5)', [crypto.randomUUID(), contentId, fileId, `${state}.txt`, !['inactive', 'not_download'].includes(state)]);
  }
}

const clean = library.clean;
const cleanScan = (await db.query('SELECT id FROM file_scan WHERE directus_file_id = $1', [clean.fileId])).rows[0].id;
await db.end();

const roleTokens = {};
for (const role of ['Contributor', 'Moderator', 'Editor', 'Publisher']) {
  const email = `gm-integration-${role.toLowerCase()}@example.com`;
  roleTokens[role] = (await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Integration-password-123!' }),
  })).data.access_token;
}

fs.writeFileSync(OUTPUT, JSON.stringify({
  admin,
  roleTokens,
  reviewSubmissionId: review.clean.submissionId,
  reviewCases: Object.fromEntries(Object.entries(review).map(([key, value]) => [key, value.submissionId])),
  libraryCases: Object.fromEntries(Object.entries(library).map(([key, value]) => [key, value.fileId])),
  promotionCases: promotion,
  staffMediaToken: admin,
  publicDocumentId: clean.contentId,
  publicDocumentFileId: clean.fileId,
  publicFileScanId: cleanScan,
}, null, 2));
