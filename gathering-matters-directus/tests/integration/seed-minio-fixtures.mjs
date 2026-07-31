import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { client, s3 } from './s3-client.mjs';

const OUTPUT = process.env.GM_MINIO_FIXTURE_OUTPUT;
const BUCKET = process.env.GM_MINIO_BUCKET;
if (!OUTPUT || !BUCKET || !process.env.TEST_DATABASE_URL) throw new Error('set GM_MINIO_FIXTURE_OUTPUT, GM_MINIO_BUCKET, and TEST_DATABASE_URL');

const objectKey = `integration/${crypto.randomUUID()}/download.txt`;
const initialBody = Buffer.from('minio-initial-body\n');
const s3Client = client();
await s3Client.send(new s3.PutObjectCommand({ Bucket: BUCKET, Key: objectKey, Body: initialBody, ContentType: 'text/plain' }));
const initialHead = await s3Client.send(new s3.HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }));
if (!initialHead.VersionId || !initialHead.ETag) throw new Error('MinIO did not return versioning or ETag metadata');

const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
const adminUser = (await db.query("SELECT id FROM directus_users WHERE email = 'admin@example.com' LIMIT 1")).rows[0];
if (!adminUser) throw new Error('disposable admin user not found');
let contentType = (await db.query('SELECT id FROM content_type WHERE is_active = true ORDER BY id LIMIT 1')).rows[0];
if (!contentType) {
  contentType = { id: crypto.randomUUID() };
  await db.query('INSERT INTO content_type (id, name, slug, is_active) VALUES ($1, $2, $3, true)', [contentType.id, 'MinIO Integration Type', `minio-${contentType.id.slice(0, 8)}`]);
}

const fileId = crypto.randomUUID();
const submissionId = crypto.randomUUID();
const contentId = crypto.randomUUID();
const scanId = crypto.randomUUID();
await db.query(`INSERT INTO directus_files
  (id, storage, filename_disk, filename_download, title, type, created_on, modified_on, uploaded_on, filesize)
  VALUES ($1, 's3', $2, 'minio-download.txt', 'MinIO integration download', 'text/plain', now(), now(), now(), $3)`, [fileId, objectKey, initialBody.length]);
await db.query(`INSERT INTO submission
  (id, status, date_created, source, title, body, consent, consent_at, consent_notice_version,
   contact_consent, contact_consent_at, contact_consent_notice_version, updates_consent, promotion_content_type_id)
  VALUES ($1, 'pending', now(), 'listening_program', 'MinIO integration submission', 'Disposable body', true, now(), 'integration', true, now(), 'integration', false, $2)`, [submissionId, contentType.id]);
await db.query('INSERT INTO submission_file (id, submission_id, directus_file_id, label, sort) VALUES ($1, $2, $3, $4, 0)', [crypto.randomUUID(), submissionId, fileId, 'minio-download.txt']);
await db.query(`INSERT INTO file_scan
  (id, directus_file_id, object_key, bucket, object_version_id, etag, origin, scan_status)
  VALUES ($1, $2, $3, $4, $5, $6, 'PUBLIC_SUBMISSION', 'NO_THREATS_FOUND')`, [scanId, fileId, objectKey, BUCKET, initialHead.VersionId, String(initialHead.ETag).replace(/^"|"$/g, '')]);
await db.query(`INSERT INTO content_item
  (id, status, date_created, title, slug, summary, body, content_type_id, source, featured, published_at, privacy_reviewed_at, privacy_reviewed_by)
  VALUES ($1, 'published', now(), 'MinIO integration item', $2, 'summary', 'body', $3, 'listening_program', false, now() - interval '1 day', now(), $4)`, [contentId, `minio-${contentId.slice(0, 8)}`, contentType.id, adminUser.id]);
await db.query('INSERT INTO content_item_file (id, content_item_id, directus_file_id, label, sort, is_download) VALUES ($1, $2, $3, $4, 0, true)', [crypto.randomUUID(), contentId, fileId, 'minio-download.txt']);
await db.end();

fs.writeFileSync(OUTPUT, JSON.stringify({ fileId, scanId, objectKey, bucket: BUCKET, initialVersionId: initialHead.VersionId, initialEtag: String(initialHead.ETag).replace(/^"|"$/g, ''), initialBody: initialBody.toString() }, null, 2));
