import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('anonymous reviewer access is denied', skip, async () => {
  const { response } = await getReview();
  assert.equal(response.status, 403);
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

