// Pure unit tests for the scan-event logic. No AWS/Directus. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScanEvent, decideAction } from '../src/scan-event.js';

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
  const d = decideAction({ scan_status: 'PENDING', guardduty_event_id: null, event_time: null }, r);
  assert.equal(d.action, 'apply'); assert.equal(d.release, true);
});

test('non-clean statuses apply but never release', () => {
  for (const s of ['THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED']) {
    const r = evaluateScanEvent(ev(s), CFG); assert.equal(r.valid, true);
    const d = decideAction({ scan_status: 'PENDING' }, r);
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
  const d = decideAction({ scan_status: 'PENDING', guardduty_event_id: 'evt-1', event_time: '2026-07-31T12:00:00Z' }, r);
  assert.equal(d.action, 'ignore-duplicate');
});

test('stale event (not newer) is ignored', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND', { id: 'evt-2', time: '2026-07-31T11:00:00Z' }), CFG);
  const d = decideAction({ scan_status: 'NO_THREATS_FOUND', guardduty_event_id: 'evt-1', event_time: '2026-07-31T12:00:00Z' }, r);
  assert.equal(d.action, 'ignore-stale');
});

test('newer event applies over an older one', () => {
  const r = evaluateScanEvent(ev('THREATS_FOUND', { id: 'evt-3', time: '2026-07-31T13:00:00Z' }), CFG);
  const d = decideAction({ scan_status: 'NO_THREATS_FOUND', guardduty_event_id: 'evt-1', event_time: '2026-07-31T12:00:00Z' }, r);
  assert.equal(d.action, 'apply'); assert.equal(d.release, false);
});

test('no existing file_scan row fails closed (no release)', () => {
  const r = evaluateScanEvent(ev('NO_THREATS_FOUND'), CFG);
  const d = decideAction(null, r);
  assert.equal(d.action, 'ignore-no-record'); assert.equal(d.release, false);
});
