// Pure unit tests for the scan-event logic. No AWS/Directus. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScanEvent, decideAction, normalizeObjectKey, isDerivativeKey, fileIdFromObjectKey } from '../src/scan-event.js';

const CFG = { account: '025452941754', region: 'us-west-2', bucket: 'gathering-matters-directus-media-025452941754-us-west-2' };
const ev = (status, over = {}) => ({
  source: 'aws.guardduty',
  'detail-type': 'GuardDuty Malware Protection Object Scan Result',
  account: CFG.account, region: CFG.region, id: 'evt-1', time: '2026-07-31T12:00:00Z',
  detail: { s3ObjectDetails: { bucketName: CFG.bucket, objectKey: 'abc.pdf', versionId: 'v1', eTag: 'e1' }, scanResultDetails: { scanResultStatus: status } },
  ...over,
});

test('valid clean event parses and releases to review', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND'), CFG);
  assert.equal(r.valid, true); assert.equal(r.status, 'NO_THREATS_FOUND'); assert.equal(r.objectKey, 'abc.pdf');
  const d = decideAction({ scan_status: 'PENDING', guardduty_event_id: null, event_time: null, object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v1', etag: 'e1' }, r);
  assert.equal(d.action, 'apply'); assert.equal(d.release, true);
});

test('non-clean statuses apply but never release', () => {
  for (const s of ['THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED']) {
    const r = evaluateScanEvent(ev(s), CFG); assert.equal(r.valid, true);
    const d = decideAction({ scan_status: 'PENDING', object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v1', etag: 'e1' }, r);
    assert.equal(d.action, 'apply'); assert.equal(d.release, false, `${s} must not release`);
  }
});

test('rejects unknown/missing status', () => {
  assert.equal(evaluateScanEvent(ev('BOGUS'), CFG).valid, false);
  const noStatus = ev('NO_THREATS_FOUND'); delete noStatus.detail.scanResultDetails; assert.equal(evaluateScanEvent(noStatus, CFG).valid, false);
});

test('rejects wrong source / detail-type / account / region / bucket / objectKey / id', () => {
  assert.equal(evaluateScanEvent(ev('NO_THREATS_FOUND', { source: 'aws.s3' }), CFG).valid, false);
  assert.equal(evaluateScanEvent(ev('NO_THREATS_FOUND', { 'detail-type': 'Other' }), CFG).valid, false);
  assert.equal(evaluateScanEvent(ev('NO_THREATS_FOUND', { account: '999999999999' }), CFG).valid, false);
  assert.equal(evaluateScanEvent(ev('NO_THREATS_FOUND', { region: 'us-east-1' }), CFG).valid, false);
  const wrongBucket = ev('NO_THREATS_FOUND'); wrongBucket.detail.s3ObjectDetails.bucketName = 'other'; assert.equal(evaluateScanEvent(wrongBucket, CFG).valid, false);
  const noKey = ev('NO_THREATS_FOUND'); delete noKey.detail.s3ObjectDetails.objectKey; assert.equal(evaluateScanEvent(noKey, CFG).valid, false);
  assert.equal(evaluateScanEvent(ev('NO_THREATS_FOUND', { id: undefined }), CFG).valid, false);
});

test('rejects malformed / non-object events', () => {
  assert.equal(evaluateScanEvent(null, CFG).valid, false);
  assert.equal(evaluateScanEvent('not-json', CFG).valid, false);
  assert.equal(evaluateScanEvent({ source: 'aws.guardduty', 'detail-type': 'GuardDuty Malware Protection Object Scan Result' }, CFG).valid, false);
});

test('duplicate event id is ignored', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND'), CFG);
  const d = decideAction({ scan_status: 'PENDING', guardduty_event_id: 'evt-1', event_time: '2026-07-31T12:00:00Z', object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v1', etag: 'e1' }, r);
  assert.equal(d.action, 'ignore-duplicate');
});

test('stale event (not newer) is ignored', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND', { id: 'evt-2', time: '2026-07-31T11:00:00Z' }), CFG);
  const d = decideAction({ scan_status: 'NO_THREATS_FOUND', guardduty_event_id: 'evt-1', event_time: '2026-07-31T12:00:00Z', object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v1', etag: 'e1' }, r);
  assert.equal(d.action, 'ignore-stale');
});

test('newer event applies over an older one', () => {
  const r = evaluateScanEvent(ev('THREATS_FOUND', { id: 'evt-3', time: '2026-07-31T13:00:00Z' }), CFG);
  const d = decideAction({ scan_status: 'NO_THREATS_FOUND', guardduty_event_id: 'evt-1', event_time: '2026-07-31T12:00:00Z', object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v1', etag: 'e1' }, r);
  assert.equal(d.action, 'apply'); assert.equal(d.release, false);
});

test('no existing file_scan row fails closed (no release)', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND'), CFG);
  const d = decideAction(null, r);
  assert.equal(d.action, 'retry-no-record'); assert.equal(d.release, false);
});

test('URL-encoded keys are normalized exactly once', () => {
  assert.equal(normalizeObjectKey('public%2Fsubmission%2Fhello%20world.pdf'), 'public/submission/hello world.pdf');
  assert.equal(normalizeObjectKey('public%252Fsubmission%252Fliteral.pdf'), 'public%2Fsubmission%2Fliteral.pdf');
  assert.equal(normalizeObjectKey('%E0%A4%A'), null);
});

test('version and ETag mismatches cannot update the current file row', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND'), CFG);
  assert.equal(decideAction({ object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v-old', etag: 'e1' }, r).action, 'ignore-object-mismatch');
  assert.equal(decideAction({ object_key: 'abc.pdf', bucket: CFG.bucket, object_version_id: 'v1', etag: 'different' }, r).action, 'ignore-object-mismatch');
});

const UUID = '3e3507f2-d981-466f-aa14-64ab7ea3eabd';

test('isDerivativeKey flags `<id>__<hash>.<ext>` transforms and nothing else', () => {
  assert.equal(isDerivativeKey(`${UUID}__7809681e43a17c0d.avif`), true);
  assert.equal(isDerivativeKey(`prefix/${UUID}__abc.webp`), true);
  assert.equal(isDerivativeKey(`${UUID}.jpg`), false);      // original upload
  assert.equal(isDerivativeKey('uploads/a.pdf'), false);    // legacy/test key
  assert.equal(isDerivativeKey(null), false);
});

test('fileIdFromObjectKey extracts the file id only from a bare `<uuid>.<ext>` original', () => {
  assert.equal(fileIdFromObjectKey(`${UUID}.jpg`), UUID);
  assert.equal(fileIdFromObjectKey(`${UUID.toUpperCase()}.PNG`), UUID); // lowercased
  assert.equal(fileIdFromObjectKey(`${UUID}__hash.avif`), null);        // derivative
  assert.equal(fileIdFromObjectKey('uploads/a.pdf'), null);            // not a uuid key
  assert.equal(fileIdFromObjectKey(null), null);
});
