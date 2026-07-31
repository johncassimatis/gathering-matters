// Pure GuardDuty Malware Protection scan-event logic for the Directus consumer.
//
// No AWS/Directus/network dependencies - unit-testable with mocked events.
// The consumer shell (index.js) polls SQS and applies these decisions inside a
// single DB transaction. Fail-closed: anything unexpected -> reject, never
// release a file.
//
// Hard rule enforced here: a clean result may only release a file from
// "Pending Malware Scan" to "Clean Staff Review". This module NEVER decides to
// move a file to "Public Downloads" (that is the editorial workflow's job).

export const SCAN_STATUSES = new Set(['NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED']);
const DETAIL_TYPE = 'GuardDuty Malware Protection Object Scan Result';

// Parse + validate one EventBridge event against expected identity.
// cfg: { account, region, bucket } (any omitted field is not checked).
// Returns { valid:true, source, eventId, eventTime, objectKey, versionId, etag, status }
// or { valid:false, reason }.
export function evaluateScanEvent(raw, cfg = {}) {
  if (!raw || typeof raw !== 'object') return { valid: false, reason: 'event is not an object' };
  if (raw.source !== 'aws.guardduty') return { valid: false, reason: `unexpected source: ${raw.source}` };
  if (raw['detail-type'] !== DETAIL_TYPE) return { valid: false, reason: `unexpected detail-type: ${raw['detail-type']}` };
  if (cfg.account && raw.account !== cfg.account) return { valid: false, reason: 'wrong account' };
  if (cfg.region && raw.region !== cfg.region) return { valid: false, reason: 'wrong region' };

  const detail = raw.detail;
  if (!detail || typeof detail !== 'object') return { valid: false, reason: 'missing detail' };
  const s3 = detail.s3ObjectDetails;
  if (!s3 || typeof s3 !== 'object') return { valid: false, reason: 'missing s3ObjectDetails' };
  if (cfg.bucket && s3.bucketName !== cfg.bucket) return { valid: false, reason: 'wrong bucket' };
  const objectKey = s3.objectKey;
  if (!objectKey || typeof objectKey !== 'string') return { valid: false, reason: 'missing objectKey' };

  const status = detail.scanResultDetails?.scanResultStatus;
  if (!SCAN_STATUSES.has(status)) return { valid: false, reason: `unknown scanResultStatus: ${status}` };

  const eventId = raw.id;
  if (!eventId) return { valid: false, reason: 'missing event id' };
  const eventTime = raw.time || detail.eventTime || null;

  return { valid: true, source: raw.source, eventId, eventTime, objectKey, versionId: s3.versionId ?? null, etag: s3.eTag ?? null, status };
}

// Decide what to do given the CURRENT file_scan row and a validated event.
// current: { scan_status, guardduty_event_id, event_time, object_version_id } | null
// Returns { action, release } where:
//   action: 'ignore-duplicate' | 'ignore-stale' | 'ignore-no-record' | 'apply'
//   release: true only when action='apply' AND status is NO_THREATS_FOUND
//            (=> move Pending Malware Scan -> Clean Staff Review, atomically)
export function decideAction(current, ev) {
  if (!current) return { action: 'ignore-no-record', release: false }; // fail closed: no PENDING row to advance
  if (current.guardduty_event_id && current.guardduty_event_id === ev.eventId) return { action: 'ignore-duplicate', release: false };
  // Stale: an event no newer than what we already recorded must not overwrite.
  if (current.event_time && ev.eventTime && new Date(ev.eventTime) <= new Date(current.event_time)) {
    return { action: 'ignore-stale', release: false };
  }
  return { action: 'apply', release: ev.status === 'NO_THREATS_FOUND' };
}

// Statuses that require an engineering alert (non-clean outcomes).
export const ALERT_STATUSES = new Set(['THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED']);
