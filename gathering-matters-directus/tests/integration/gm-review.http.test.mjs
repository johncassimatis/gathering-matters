import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = String(process.env.GM_INTEGRATION_BASE_URL || '').replace(/\/$/, '');
const SUBMISSION_ID = process.env.GM_REVIEW_SUBMISSION_ID || '';
const ROLE_TOKENS = (() => {
  try { return JSON.parse(process.env.GM_REVIEW_ROLE_TOKENS || '{}'); } catch { return {}; }
})();
const LIVE = Boolean(BASE && SUBMISSION_ID);
const skip = LIVE ? {} : { skip: 'set GM_INTEGRATION_BASE_URL and GM_REVIEW_SUBMISSION_ID' };

async function getReview(submissionId = SUBMISSION_ID, token = null) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${BASE}/gm-review/submissions/${submissionId}/files`, { headers });
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

function assertPrivateShape(body) {
  const text = JSON.stringify(body || {});
  for (const forbidden of [
    'filename_disk', 'storage', 'bucket', 'object_key', 'etag', 'object_version_id',
    'guardduty', 'scanResult', 'scan_result', 'error_detail',
  ]) assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `review response leaked ${forbidden}`);
}

function randomUuidV7() {
  const ts = Date.now();
  const b = crypto.randomBytes(16);
  b[0] = Math.floor(ts / 2 ** 40) & 0xff; b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = (ts >>> 24) & 0xff; b[3] = (ts >>> 16) & 0xff; b[4] = (ts >>> 8) & 0xff; b[5] = ts & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

test('anonymous reviewer access is denied', skip, async () => {
  const { response } = await getReview();
  assert.equal(response.status, 403);
});

// The regression this fix addresses: a genuine uuidv7 submission id (SUBMISSION_ID
// is seeded via the DB default) must pass identifier validation and reach the
// authorization gate (403 for anonymous), NOT the invalid-id 404 it returned when
// the validator only accepted UUID versions 1-5.
test('a canonical UUIDv7 submission id passes identifier validation (403 auth gate, not 404)', skip, async () => {
  const { response, body } = await getReview(SUBMISSION_ID);
  assert.equal(response.status, 403, 'a valid v7 id must reach the auth gate, not be rejected by version');
  assert.notDeepEqual(body, { error: 'not_found' });
});

test('a fresh nonexistent canonical UUIDv7 is not rejected by version (403 auth gate)', skip, async () => {
  const { response } = await getReview(randomUuidV7());
  assert.equal(response.status, 403);
});

test('a UUIDv4 identifier is rejected before database lookup (404 not_found)', skip, async () => {
  const { response, body } = await getReview('00000000-0000-4000-8000-000000000000');
  assert.equal(response.status, 404);
  assert.deepEqual(body, { error: 'not_found' });
});

test('the nil UUID is rejected before database lookup (404 not_found)', skip, async () => {
  const { response } = await getReview('00000000-0000-0000-0000-000000000000');
  assert.equal(response.status, 404);
});

test('a malformed identifier is rejected before database lookup (404 not_found)', skip, async () => {
  const { response } = await getReview('not-a-uuid');
  assert.equal(response.status, 404);
});

test('an authorized reviewer gets a neutral empty result for a valid nonexistent UUIDv7 (no existence leak of protected metadata)', { skip: skip.skip || !(ROLE_TOKENS.Moderator || ROLE_TOKENS.Editor || ROLE_TOKENS.Publisher) ? 'missing reviewer token' : undefined }, async () => {
  const token = ROLE_TOKENS.Moderator || ROLE_TOKENS.Editor || ROLE_TOKENS.Publisher;
  const { response, body } = await getReview(randomUuidV7(), token);
  assert.equal(response.status, 200);
  assertPrivateShape(body);
  assert.deepEqual(body.data, []);
});

for (const role of ['Contributor', 'Moderator', 'Editor', 'Publisher']) {
  test(`${role} reviewer behavior is exercised through HTTP`, { skip: skip.skip || !ROLE_TOKENS[role] ? `missing token for ${role}` : undefined }, async () => {
    const { response, body } = await getReview(SUBMISSION_ID, ROLE_TOKENS[role]);
    if (role === 'Contributor') assert.equal(response.status, 403);
    else assert.equal(response.status, 200);
    if (response.status === 200) {
      assertPrivateShape(body);
      assert.ok(Array.isArray(body.data));
      for (const item of body.data) {
        assert.ok(['CLEAN', 'PENDING', 'UNAVAILABLE'].includes(item.scan_state));
        if (item.scan_state !== 'CLEAN') assert.equal('file_id' in item, false);
      }
    }
  });
}

const cases = (() => {
  try { return JSON.parse(process.env.GM_REVIEW_CASE_SUBMISSION_IDS || '{}'); } catch { return {}; }
})();
for (const state of ['pending', 'clean', 'threats', 'unsupported', 'failed']) {
  test(`reviewer ${state} metadata is neutral and content remains private`, { skip: skip.skip || !cases[state] ? `missing ${state} fixture` : undefined }, async () => {
    const token = ROLE_TOKENS.Moderator || ROLE_TOKENS.Editor || ROLE_TOKENS.Publisher;
    const { response, body } = await getReview(cases[state], token);
    assert.equal(response.status, 200);
    assertPrivateShape(body);
    for (const item of body.data) {
      if (state === 'pending') assert.equal(item.scan_state, 'PENDING');
      if (state === 'threats' || state === 'unsupported' || state === 'failed') assert.equal(item.file_id, undefined);
    }
  });
}

test('review metadata does not provide a mutation path for scan status', skip, async () => {
  const token = ROLE_TOKENS.Moderator || ROLE_TOKENS.Editor || ROLE_TOKENS.Publisher;
  const before = await getReview(SUBMISSION_ID, token);
  assert.equal(before.response.status, 200);
  const mutation = await fetch(`${BASE}/gm-review/submissions/${SUBMISSION_ID}/files`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ scan_status: 'NO_THREATS_FOUND' }),
  });
  assert.notEqual(mutation.status, 200);
  const after = await getReview(SUBMISSION_ID, token);
  assert.deepEqual(after.body, before.body);
});

