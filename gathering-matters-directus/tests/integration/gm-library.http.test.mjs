import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
let cases = {};
try { cases = JSON.parse(process.env.GM_LIBRARY_CASES || '{}'); } catch {}
const LIVE = Boolean(BASE && cases.clean);
const skip = LIVE ? {} : { skip: 'set GM_INTEGRATION_BASE_URL and GM_LIBRARY_CASES' };

async function download(id) {
  const response = await fetch(`${BASE}/gm-library/downloads/${id}`);
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.text() : await response.arrayBuffer();
  return { response, body };
}

function assertGenericBlocked(result) {
  assert.equal(result.response.status, 404);
  if (typeof result.body === 'string') {
    assert.equal(result.body.includes('bucket'), false);
    assert.equal(result.body.includes('object'), false);
    assert.equal(result.body.includes('etag'), false);
    assert.equal(result.body.includes('version'), false);
    assert.equal(result.body.includes('GuardDuty'), false);
  }
}

test('published clean active downloadable file streams through the custom route', skip, async () => {
  const result = await download(cases.clean);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(result.response.headers.get('content-disposition') || '', /^attachment; filename="[A-Za-z0-9._ -]+"/);
});

for (const state of [
  'unpublished', 'archived', 'future', 'inactive', 'deleted', 'not_download', 'pending',
  'threats', 'unsupported', 'access_denied', 'failed', 'missing_scan', 'wrong_version', 'etag_mismatch',
]) {
  test(`download is blocked for ${state}`, { skip: skip.skip || !cases[state] ? `missing ${state} fixture` : undefined }, async () => {
    assertGenericBlocked(await download(cases[state]));
  });
}

test('known UUID after revocation is inaccessible and never leaks storage metadata', { skip: skip.skip || !cases.revoked ? 'missing revoked fixture' : undefined }, async () => {
  assertGenericBlocked(await download(cases.revoked));
});

test('anonymous Directus assets are blocked after managed public-policy revocation', { skip: skip.skip || !cases.clean ? 'missing clean fixture' : undefined }, async () => {
  const response = await fetch(`${BASE}/assets/${cases.clean}`);
  assert.notEqual(response.status, 200);
});

test('malformed UUIDs are rejected before any storage lookup', skip, async () => {
  assertGenericBlocked(await download('not-a-uuid'));
});

