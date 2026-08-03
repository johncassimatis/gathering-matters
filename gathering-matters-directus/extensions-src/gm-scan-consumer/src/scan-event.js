// Pure GuardDuty Malware Protection scan-event logic for the Directus consumer.
//
// The consumer receives events at-least-once. A valid event can arrive before
// the intake transaction commits its submission_file/file_scan rows, so a valid
// event with no matching row is RETRYABLE, not ignorable.

export const SCAN_STATUSES = new Set([
  'NO_THREATS_FOUND',
  'THREATS_FOUND',
  'UNSUPPORTED',
  'ACCESS_DENIED',
  'FAILED',
]);
export const ALERT_STATUSES = new Set(['THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED']);
const DETAIL_TYPE = 'GuardDuty Malware Protection Object Scan Result';
const EVENT_SCHEMA_VERSION = '1.0';

export function normalizeObjectKey(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    // EventBridge/S3 object keys are URL-encoded once. Do not translate '+'
    // into a space: '+' is a valid literal S3 key character.
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function normalizeEtag(value) {
  return value == null ? null : String(value).replace(/^"|"$/g, '');
}

function validEventTime(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

// Parse + validate one EventBridge event against expected identity.
// cfg: { account, region, bucket } (any omitted field is not checked).
export function evaluateScanEvent(raw, cfg = {}) {
  if (!raw || typeof raw !== 'object') return { valid: false, reason: 'event is not an object' };
  if (raw.source !== 'aws.guardduty') return { valid: false, reason: `unexpected source: ${raw.source}` };
  if (raw['detail-type'] !== DETAIL_TYPE) return { valid: false, reason: `unexpected detail-type: ${raw['detail-type']}` };
  if (cfg.account && raw.account !== cfg.account) return { valid: false, reason: 'wrong account' };
  if (cfg.region && raw.region !== cfg.region) return { valid: false, reason: 'wrong region' };

  const detail = raw.detail;
  if (!detail || typeof detail !== 'object') return { valid: false, reason: 'missing detail' };
  if (detail.schemaVersion && detail.schemaVersion !== EVENT_SCHEMA_VERSION) {
    return { valid: false, reason: 'unsupported schema version' };
  }
  if (detail.scanStatus && detail.scanStatus !== 'COMPLETED') {
    return { valid: false, reason: 'scan did not complete' };
  }

  const s3 = detail.s3ObjectDetails;
  if (!s3 || typeof s3 !== 'object') return { valid: false, reason: 'missing s3ObjectDetails' };
  if (s3.resourceType && s3.resourceType !== 'S3_OBJECT') {
    return { valid: false, reason: 'unexpected resource type' };
  }
  if (cfg.bucket && s3.bucketName !== cfg.bucket) return { valid: false, reason: 'wrong bucket' };

  const objectKey = normalizeObjectKey(s3.objectKey);
  if (!objectKey) return { valid: false, reason: 'missing or malformed objectKey' };

  const status = detail.scanResultDetails?.scanResultStatus;
  if (!SCAN_STATUSES.has(status)) return { valid: false, reason: `unknown scanResultStatus: ${status}` };

  const eventId = typeof raw.id === 'string' && raw.id.trim() ? raw.id : null;
  if (!eventId) return { valid: false, reason: 'missing event id' };
  const eventTime = validEventTime(raw.time || detail.eventTime);
  if (!eventTime) return { valid: false, reason: 'missing or malformed event time' };

  return {
    valid: true,
    source: raw.source,
    account: raw.account,
    region: raw.region,
    bucket: s3.bucketName,
    eventId,
    eventTime,
    objectKey,
    versionId: s3.versionId ?? s3.objectVersionId ?? null,
    etag: normalizeEtag(s3.eTag ?? s3.etag ?? null),
    status,
  };
}

export function matchesCurrentObject(current, ev) {
  if (!current || current.object_key !== ev.objectKey) return false;
  if (current.bucket && ev.bucket && current.bucket !== ev.bucket) return false;
  if (current.object_version_id && ev.versionId && current.object_version_id !== ev.versionId) return false;
  if (current.etag && ev.etag && normalizeEtag(current.etag) !== normalizeEtag(ev.etag)) return false;
  return true;
}

// Decide what to do given the CURRENT file_scan row and a validated event.
// A missing row is deliberately retryable because the intake transaction may
// still be committing. A version/ETag mismatch is conclusively irrelevant for
// the current Directus file and may be deleted rather than retried forever.
export function decideAction(current, ev) {
  if (!current) return { action: 'retry-no-record', release: false };
  if (!matchesCurrentObject(current, ev)) return { action: 'ignore-object-mismatch', release: false };
  if (current.guardduty_event_id && current.guardduty_event_id === ev.eventId) return { action: 'ignore-duplicate', release: false };
  if (current.event_time && ev.eventTime && new Date(ev.eventTime) <= new Date(current.event_time)) {
    return { action: 'ignore-stale', release: false };
  }
  return { action: 'apply', release: ev.status === 'NO_THREATS_FOUND' };
}
