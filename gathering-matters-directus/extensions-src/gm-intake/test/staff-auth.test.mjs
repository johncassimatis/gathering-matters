import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeStaffUpload, parseRoleIds, isCanonicalUuidV7, normalizeUuidV7 } from '../src/staff-auth.js';

const ROLE = 'a1111111-1111-4111-8111-111111111111';
const env = { GM_STAFF_FILE_UPLOAD_ROLE_IDS: `${ROLE}, b2222222-2222-4222-8222-222222222222` };

test('denies missing/malformed accountability (fail closed)', () => {
  for (const acc of [null, undefined, 'x', 42, {}]) {
    assert.equal(authorizeStaffUpload(acc, env).ok, false);
  }
});

test('denies an unauthenticated caller (no user)', () => {
  assert.equal(authorizeStaffUpload({ role: ROLE }, env).ok, false); // role but no user
  assert.equal(authorizeStaffUpload({ admin: false }, env).ok, false);
});

test('allows an administrator', () => {
  const r = authorizeStaffUpload({ user: 'u1', admin: true }, env);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'admin');
});

test('allows an authenticated user whose role is allowlisted', () => {
  const r = authorizeStaffUpload({ user: 'u2', admin: false, role: ROLE }, env);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'allowlisted role');
});

test('denies an authenticated user whose role is not allowlisted', () => {
  assert.equal(authorizeStaffUpload({ user: 'u3', role: 'c3333333-3333-4333-8333-333333333333' }, env).ok, false);
});

test('denies every authenticated user when the allowlist is empty and not admin', () => {
  assert.equal(authorizeStaffUpload({ user: 'u4', role: ROLE }, { GM_STAFF_FILE_UPLOAD_ROLE_IDS: '' }).ok, false);
  assert.equal(authorizeStaffUpload({ user: 'u4', role: ROLE }, {}).ok, false);
});

test('a direct-policy-only user (no matching role) fails closed', () => {
  // Directus accountability exposes .role, not direct-user policies, so a user
  // authorized only via a direct policy is denied unless intentionally listed.
  assert.equal(authorizeStaffUpload({ user: 'u5', role: null }, env).ok, false);
});

test('parseRoleIds trims, drops empties, dedups', () => {
  const s = parseRoleIds(' a , b , , a ');
  assert.deepEqual([...s].sort(), ['a', 'b']);
});

test('isCanonicalUuidV7 accepts a canonical v7 (lower + uppercase-normalized)', () => {
  const v7 = '018f2e6a-7b3c-7def-8a1b-0123456789ab';
  assert.equal(isCanonicalUuidV7(v7), true);
  assert.equal(normalizeUuidV7(v7.toUpperCase()), v7);
});

test('isCanonicalUuidV7 rejects v1-v6, v8, nil, malformed, non-string', () => {
  for (const ver of ['1', '2', '3', '4', '5', '6', '8']) {
    assert.equal(isCanonicalUuidV7(`018f2e6a-7b3c-${ver}def-8a1b-0123456789ab`), false);
  }
  assert.equal(isCanonicalUuidV7('00000000-0000-0000-0000-000000000000'), false);
  assert.equal(isCanonicalUuidV7('not-a-uuid'), false);
  assert.equal(isCanonicalUuidV7(' 018f2e6a-7b3c-7def-8a1b-0123456789ab'), false);
  for (const v of [null, undefined, 42, {}]) assert.equal(isCanonicalUuidV7(v), false);
});
