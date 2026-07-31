import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { client, s3 } from './s3-client.mjs';

const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GM_MINIO_FIXTURE_OUTPUT, 'utf8'));
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const s3Client = client();

async function download() {
  const response = await fetch(`${BASE}/gm-library/downloads/${fixture.fileId}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}

function assertNoLeak(response, bytes) {
  assert.equal(response.status, 404);
  const body = bytes.toString('utf8');
  for (const value of [fixture.objectKey, fixture.initialVersionId, fixture.initialEtag, 'bucket', 'object', 'etag', 'version', 'GuardDuty']) {
    assert.equal(body.toLowerCase().includes(String(value).toLowerCase()), false, `response leaked ${value}`);
  }
  assert.equal(body.includes(fixture.initialBody.trim()), false);
  assert.equal(body.includes('new-version-body'), false);
}

async function updateScan(fields) {
  const entries = Object.entries(fields);
  const set = entries.map(([key], index) => `${key} = $${index + 1}`).join(', ');
  await db.query(`UPDATE file_scan SET ${set} WHERE id = $${entries.length + 1}`, [...entries.map(([, value]) => value), fixture.scanId]);
}

test('MinIO request-time identity gate', async (t) => {
  await db.connect();
  await t.test('matching current version and ETag streams the body', async () => {
    const { response, bytes } = await download();
    assert.equal(response.status, 200);
    assert.deepEqual(bytes, Buffer.from(fixture.initialBody));
  });

  await t.test('new version under the same key fails closed before GetObject', async () => {
    await s3Client.send(new s3.PutObjectCommand({ Bucket: fixture.bucket, Key: fixture.objectKey, Body: Buffer.from('new-version-body\n') }));
    assertNoLeak(...Object.values(await download()));
  });

  const current = await s3Client.send(new s3.HeadObjectCommand({ Bucket: fixture.bucket, Key: fixture.objectKey }));
  const currentVersion = current.VersionId;
  const currentEtag = String(current.ETag).replace(/^"|"$/g, '');

  await t.test('current version with stale ETag fails closed', async () => {
    await updateScan({ object_version_id: currentVersion, etag: 'stale-etag' });
    assertNoLeak(...Object.values(await download()));
  });

  await t.test('matching current version and ETag succeeds again', async () => {
    await updateScan({ object_version_id: currentVersion, etag: currentEtag });
    const { response, bytes } = await download();
    assert.equal(response.status, 200);
    assert.deepEqual(bytes, Buffer.from('new-version-body\n'));
  });

  await t.test('missing version is allowed only under the explicit unversioned policy', async () => {
    assert.equal(process.env.GM_PUBLIC_DOWNLOAD_REQUIRE_VERSION, 'false');
    await updateScan({ object_version_id: null, etag: currentEtag });
    const { response, bytes } = await download();
    assert.equal(response.status, 200);
    assert.deepEqual(bytes, Buffer.from('new-version-body\n'));
  });

  await t.test('missing ETag fails closed when ETag validation is required', async () => {
    await updateScan({ object_version_id: currentVersion, etag: null });
    assertNoLeak(...Object.values(await download()));
  });

  await t.test('HeadObject failure fails closed', async () => {
    await updateScan({ object_key: `${fixture.objectKey}-missing` });
    assertNoLeak(...Object.values(await download()));
    await updateScan({ object_key: fixture.objectKey, object_version_id: currentVersion, etag: currentEtag });
  });

  await t.test('delete marker fails closed', async () => {
    await s3Client.send(new s3.DeleteObjectCommand({ Bucket: fixture.bucket, Key: fixture.objectKey }));
    assertNoLeak(...Object.values(await download()));
  });

  await db.end();
});
