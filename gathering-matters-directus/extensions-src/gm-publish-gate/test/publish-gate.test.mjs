// Exhaustive proof of the editorial gate. No Directus/AWS. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPubliclyDownloadable, targetFolderFor } from '../src/publish-gate.js';

const F = { pending: 'PEND', review: 'REV', public: 'PUB' };
const STATUSES = ['NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED', 'PENDING', undefined];
const BOOLS = [true, false];

test('publicly downloadable ONLY when clean AND published AND is_download AND active (full truth table)', () => {
  for (const scanStatus of STATUSES)
    for (const published of BOOLS)
      for (const isDownload of BOOLS)
        for (const associationActive of BOOLS) {
          const state = { scanStatus, published, isDownload, associationActive };
          const expected = scanStatus === 'NO_THREATS_FOUND' && published && isDownload && associationActive;
          assert.equal(isPubliclyDownloadable(state), expected, JSON.stringify(state));
          // Folder placement mirrors it, fail-closed.
          const folder = targetFolderFor(state, F);
          if (scanStatus !== 'NO_THREATS_FOUND') assert.equal(folder, F.pending, `non-clean must be Pending: ${JSON.stringify(state)}`);
          else if (expected) assert.equal(folder, F.public);
          else assert.equal(folder, F.review, `clean-but-not-releasable must be Clean Staff Review: ${JSON.stringify(state)}`);
        }
});

test('PROOF: editorial approval cannot override a non-clean scan', () => {
  for (const bad of ['THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED', 'PENDING', undefined]) {
    const state = { scanStatus: bad, published: true, isDownload: true, associationActive: true };
    assert.equal(isPubliclyDownloadable(state), false);
    assert.equal(targetFolderFor(state, F), F.pending);
  }
});

test('PROOF: a clean scan alone cannot create public access', () => {
  assert.equal(isPubliclyDownloadable({ scanStatus: 'NO_THREATS_FOUND', published: false, isDownload: true, associationActive: true }), false);
  assert.equal(isPubliclyDownloadable({ scanStatus: 'NO_THREATS_FOUND', published: true, isDownload: false, associationActive: true }), false);
  assert.equal(isPubliclyDownloadable({ scanStatus: 'NO_THREATS_FOUND', published: true, isDownload: true, associationActive: false }), false);
  // clean but unpublished/undownloadable stays in Clean Staff Review, not Public
  assert.equal(targetFolderFor({ scanStatus: 'NO_THREATS_FOUND', published: false, isDownload: true, associationActive: true }, F), F.review);
});

test('revocation: removing publication or download approval moves out of Public Downloads', () => {
  const publicState = { scanStatus: 'NO_THREATS_FOUND', published: true, isDownload: true, associationActive: true };
  assert.equal(targetFolderFor(publicState, F), F.public);
  assert.equal(targetFolderFor({ ...publicState, published: false }, F), F.review);   // unpublish
  assert.equal(targetFolderFor({ ...publicState, isDownload: false }, F), F.review);  // revoke is_download
  assert.equal(targetFolderFor({ ...publicState, associationActive: false }, F), F.review); // remove association
});
