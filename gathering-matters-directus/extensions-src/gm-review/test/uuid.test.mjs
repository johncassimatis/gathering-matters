import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUuidV7, isCanonicalUuidV7 } from '../src/uuid.js';

// A canonical UUIDv7: version nibble 7, variant nibble in [89ab].
const V7_LOWER = '018f2e6a-7b3c-7def-8a1b-0123456789ab';

test('accepts a canonical lowercase UUIDv7', () => {
  assert.equal(isCanonicalUuidV7(V7_LOWER), true);
  assert.equal(normalizeUuidV7(V7_LOWER), V7_LOWER);
});

test('accepts an uppercase UUIDv7 and normalizes it to lowercase for lookup', () => {
  const upper = V7_LOWER.toUpperCase();
  assert.equal(isCanonicalUuidV7(upper), true);
  assert.equal(normalizeUuidV7(upper), V7_LOWER, 'must return the lowercase form used for the DB lookup');
});

test('accepts every valid RFC variant nibble (8, 9, a, b)', () => {
  for (const v of ['8', '9', 'a', 'b']) {
    const id = `018f2e6a-7b3c-7def-${v}a1b-0123456789ab`;
    assert.equal(isCanonicalUuidV7(id), true, `variant ${v} should be accepted`);
  }
});

// Reject every other UUID version. Build each by placing the version nibble in
// the 13th hex position (start of the 3rd group) with a valid variant nibble.
for (const version of ['1', '2', '3', '4', '5', '6', '8']) {
  test(`rejects UUIDv${version}`, () => {
    const id = `018f2e6a-7b3c-${version}def-8a1b-0123456789ab`;
    assert.equal(isCanonicalUuidV7(id), false);
    assert.equal(normalizeUuidV7(id), null);
  });
}

test('rejects version nibble 0 and 9 and non-hex version placeholders', () => {
  assert.equal(isCanonicalUuidV7('018f2e6a-7b3c-0def-8a1b-0123456789ab'), false);
  assert.equal(isCanonicalUuidV7('018f2e6a-7b3c-9def-8a1b-0123456789ab'), false);
});

test('rejects the nil UUID', () => {
  assert.equal(isCanonicalUuidV7('00000000-0000-0000-0000-000000000000'), false);
});

test('rejects the max UUID', () => {
  assert.equal(isCanonicalUuidV7('ffffffff-ffff-ffff-ffff-ffffffffffff'), false);
});

test('rejects an invalid variant nibble (not 8/9/a/b)', () => {
  for (const v of ['0', '1', '7', 'c', 'd', 'e', 'f']) {
    const id = `018f2e6a-7b3c-7def-${v}a1b-0123456789ab`;
    assert.equal(isCanonicalUuidV7(id), false, `variant ${v} should be rejected`);
  }
});

test('rejects missing hyphens', () => {
  assert.equal(isCanonicalUuidV7('018f2e6a7b3c7def8a1b0123456789ab'), false);
});

test('rejects braces', () => {
  assert.equal(isCanonicalUuidV7(`{${V7_LOWER}}`), false);
});

test('rejects leading whitespace', () => {
  assert.equal(isCanonicalUuidV7(` ${V7_LOWER}`), false);
  assert.equal(isCanonicalUuidV7(`\t${V7_LOWER}`), false);
  assert.equal(isCanonicalUuidV7(`\n${V7_LOWER}`), false);
});

test('rejects trailing whitespace', () => {
  assert.equal(isCanonicalUuidV7(`${V7_LOWER} `), false);
  assert.equal(isCanonicalUuidV7(`${V7_LOWER}\n`), false);
});

test('rejects an extra prefix', () => {
  assert.equal(isCanonicalUuidV7(`x${V7_LOWER}`), false);
  assert.equal(isCanonicalUuidV7(`urn:uuid:${V7_LOWER}`), false);
});

test('rejects an extra suffix', () => {
  assert.equal(isCanonicalUuidV7(`${V7_LOWER}x`), false);
  assert.equal(isCanonicalUuidV7(`${V7_LOWER}/files`), false);
});

test('rejects a truncated UUID', () => {
  assert.equal(isCanonicalUuidV7(V7_LOWER.slice(0, -1)), false);
  assert.equal(isCanonicalUuidV7('018f2e6a-7b3c-7def-8a1b-0123456789a'), false);
});

test('rejects extra characters (too long)', () => {
  assert.equal(isCanonicalUuidV7(`${V7_LOWER}0`), false);
  assert.equal(isCanonicalUuidV7('018f2e6a-7b3c-7def-8a1b-0123456789abc'), false);
});

test('rejects malformed hexadecimal characters', () => {
  assert.equal(isCanonicalUuidV7('018f2e6g-7b3c-7def-8a1b-0123456789ab'), false); // g
  assert.equal(isCanonicalUuidV7('018f2e6a-7b3z-7def-8a1b-0123456789ab'), false); // z
});

test('rejects hyphens in the wrong positions', () => {
  assert.equal(isCanonicalUuidV7('018f2e6a7-b3c-7def-8a1b-0123456789ab'), false);
});

test('rejects non-string inputs without throwing', () => {
  for (const v of [null, undefined, 42, {}, [], true, Symbol('x')]) {
    assert.equal(isCanonicalUuidV7(v), false);
    assert.equal(normalizeUuidV7(v), null);
  }
});

test('rejects the empty string', () => {
  assert.equal(isCanonicalUuidV7(''), false);
});
