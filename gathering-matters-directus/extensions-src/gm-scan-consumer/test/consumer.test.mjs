import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processScanMessage } from '../src/index.js';

const CFG = { account: '025452941754', region: 'us-west-2', bucket: 'gm-bucket' };
const event = (status = 'NO_THREATS_FOUND', overrides = {}) => ({
  source: 'aws.guardduty',
  'detail-type': 'GuardDuty Malware Protection Object Scan Result',
  account: CFG.account,
  region: CFG.region,
  id: overrides.id || 'event-1',
  time: overrides.time || '2026-07-31T12:00:00Z',
  detail: {
    s3ObjectDetails: { bucketName: CFG.bucket, objectKey: 'uploads/a.pdf', versionId: 'v1', eTag: 'etag-1' },
    scanResultDetails: { scanResultStatus: status },
  },
});

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; }
  where(column, value) {
    if (typeof column === 'object') this.filters.push(...Object.entries(column));
    else if (arguments.length === 2) this.filters.push([column, value]);
    return this;
  }
  orderBy() { return this; }
  forUpdate() { return this; }
  select() { return this; }
  first() {
    const rows = this.db.rows[this.table] || [];
    return Promise.resolve(rows.find((row) => this.filters.every(([key, value]) => row[key] === value)) || undefined);
  }
  update(values) {
    const rows = this.db.rows[this.table] || [];
    const matches = rows.filter((row) => this.filters.every(([key, value]) => row[key] === value));
    if (this.table === 'directus_files' && this.db.failFolder) return Promise.reject(new Error('folder transition failed'));
    matches.forEach((row) => Object.assign(row, values));
    this.db.updates.push({ table: this.table, values, count: matches.length });
    return Promise.resolve(matches.length);
  }
}

function fakeDatabase(scan, file = { id: 'file-1', folder: 'PENDING' }, failFolder = false) {
  const db = { rows: { file_scan: scan ? [scan] : [], directus_files: [file] }, updates: [], failFolder };
  const fn = (table) => new Query(db, table);
  fn.transaction = async (callback) => {
    const snapshot = structuredClone(db.rows);
    try {
      return await callback(fn);
    } catch (error) {
      db.rows = snapshot;
      throw error;
    }
  };
  fn.fn = { now: () => 'now' };
  fn.state = db;
  return fn;
}

const logger = { warn() {}, error() {}, info() {} };
const baseScan = {
  id: 'scan-1', directus_file_id: 'file-1', object_key: 'uploads/a.pdf', bucket: CFG.bucket,
  object_version_id: 'v1', etag: 'etag-1', scan_status: 'PENDING', guardduty_event_id: null, event_time: null,
};

test('valid event before file_scan is retained for retry, then applies after the row appears', async () => {
  const db = fakeDatabase(null);
  const msg = { Body: JSON.stringify(event()), Attributes: { ApproximateReceiveCount: '1', SentTimestamp: String(Date.now()) } };
  const first = await processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.deepEqual(first, { ack: false, disposition: 'retry-unmatched' });

  db.state.rows.file_scan.push({ ...baseScan });
  const second = await processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.equal(second.ack, true);
  assert.equal(db.state.rows.file_scan[0].scan_status, 'NO_THREATS_FOUND');
  assert.equal(db.state.rows.directus_files[0].folder, 'REVIEW');
});

test('threat-positive event never releases a file and duplicate delivery is idempotent', async () => {
  const db = fakeDatabase({ ...baseScan });
  const msg = { Body: JSON.stringify(event('THREATS_FOUND')), Attributes: {} };
  const result = await processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.equal(result.disposition, 'applied');
  assert.equal(db.state.rows.file_scan[0].scan_status, 'THREATS_FOUND');
  assert.equal(db.state.rows.directus_files[0].folder, 'PENDING');

  const duplicate = await processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.equal(duplicate.disposition, 'ignore-duplicate');
});

test('folder transition failure rejects the transaction and leaves the message unacknowledged', async () => {
  const db = fakeDatabase({ ...baseScan }, undefined, true);
  const msg = { Body: JSON.stringify(event()), Attributes: {} };
  await assert.rejects(() => processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger }), /folder transition failed/);
  assert.equal(db.state.rows.file_scan[0].scan_status, 'PENDING');
});

test('malformed JSON is conclusively invalid and can be deleted', async () => {
  const db = fakeDatabase(null);
  const result = await processScanMessage({ msg: { Body: '{bad' }, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.deepEqual(result, { ack: true, disposition: 'invalid' });
});

test('a STAFF_MANAGED pending scan is matched by object_key, released to Clean Staff Review, and idempotent', async () => {
  // The staff-managed upload route creates exactly this row shape:
  // origin STAFF_MANAGED, PENDING, object_key = the S3 object key. The consumer
  // matches on object_key regardless of origin.
  const staffScan = { ...baseScan, origin: 'STAFF_MANAGED' };
  const db = fakeDatabase(staffScan);
  const msg = { Body: JSON.stringify(event('NO_THREATS_FOUND')), Attributes: { ApproximateReceiveCount: '1', SentTimestamp: String(Date.now()) } };
  const r = await processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.equal(r.ack, true);
  assert.equal(r.disposition, 'applied');
  assert.equal(r.releasedToStaffReview, true);
  assert.equal(db.state.rows.file_scan[0].scan_status, 'NO_THREATS_FOUND');
  assert.equal(db.state.rows.directus_files[0].folder, 'REVIEW'); // Clean Staff Review — never Public Downloads
  // Replaying the same event id is idempotent (no second transition).
  const replay = await processScanMessage({ msg, database: db, cfg: CFG, pendingFolder: 'PENDING', cleanFolder: 'REVIEW', logger });
  assert.equal(replay.disposition, 'ignore-duplicate');
  assert.equal(db.state.rows.directus_files[0].folder, 'REVIEW');
});
