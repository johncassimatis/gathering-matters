-- V009: Malware-scan status model + submission file attachments.
--
-- Additive, post-bootstrap (references directus_files). Supports Option A
-- public-distribution gating for Directus file storage on S3 + GuardDuty
-- Malware Protection. Nothing here is applied to production by this task.
--
-- Adds:
--   * submission_file: links a private submission to its uploaded files
--     (net-new; the earlier V007 attempt was never applied - see V008 note).
--   * file_scan: one current malware-scan record per directus_files object.
--     The GuardDuty S3 object tag remains the AWS-side source of truth; this
--     row is the database projection that drives Directus permissions, staff
--     workflow, APIs, and auditability. Internal S3 correlation fields
--     (object_key, bucket, version, etag) are for the scan consumer only and
--     must never be exposed through public APIs.
--
-- Fail-closed default: every new file_scan row starts PENDING and is not
-- downloadable by anyone until a verified NO_THREATS_FOUND event arrives.

-- Require the Directus file table (post-bootstrap boundary).
DO $$
BEGIN
    IF to_regclass('public.directus_files') IS NULL THEN
        RAISE EXCEPTION
          'directus_files not found. Bootstrap Directus before running this migration.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Submission attachments (mirrors content_item_file from V004)
-- ---------------------------------------------------------------------------
CREATE TABLE submission_file (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    submission_id    uuid NOT NULL REFERENCES submission(id)     ON DELETE CASCADE,
    directus_file_id uuid NOT NULL REFERENCES directus_files(id) ON DELETE RESTRICT,
    label            text,
    sort             integer,
    UNIQUE (submission_id, directus_file_id)
);
COMMENT ON TABLE submission_file IS
    'Files attached to private submissions via directus_files. Public users never read these; access is gated by scan status + Directus permissions.';

CREATE INDEX idx_submission_file_submission_sort ON submission_file (submission_id, sort, id);
CREATE INDEX idx_submission_file_file            ON submission_file (directus_file_id);

-- ---------------------------------------------------------------------------
-- Malware-scan status (one current record per directus_files object)
-- ---------------------------------------------------------------------------
CREATE TABLE file_scan (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    directus_file_id  uuid NOT NULL REFERENCES directus_files(id) ON DELETE CASCADE,

    -- Internal S3 correlation (consumer-only; never returned by public APIs).
    object_key        text,
    bucket            text,
    object_version_id text,
    etag              text,

    -- Scan projection.
    scan_status       text NOT NULL DEFAULT 'PENDING',
    guardduty_event_id text,
    event_time        timestamptz,       -- source event time; used to reject stale/duplicate events
    last_processed_at timestamptz,       -- when the consumer last wrote this row
    reason            text,              -- failure / unsupported / remediation note

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    -- One current scan record per file. The consumer updates this row in place,
    -- only advancing it when the incoming event is newer (event_time / version),
    -- so an older or duplicate event can never overwrite a newer result.
    CONSTRAINT file_scan_one_per_file UNIQUE (directus_file_id),

    CONSTRAINT file_scan_status_check CHECK (scan_status IN (
        'PENDING',
        'NO_THREATS_FOUND',
        'THREATS_FOUND',
        'UNSUPPORTED',
        'ACCESS_DENIED',
        'FAILED'
    ))
);
COMMENT ON TABLE file_scan IS
    'Database projection of GuardDuty Malware Protection scan status per directus_files object. The S3 GuardDutyMalwareScanStatus tag is authoritative on the AWS side; this row drives Directus gating. Only NO_THREATS_FOUND is releasable; every other value (and PENDING/absent) fails closed. Internal object_key/bucket/version/etag are consumer-only and must not be exposed publicly.';

COMMENT ON COLUMN file_scan.event_time IS
    'Source scan-event time. The consumer must ignore an event whose time is not newer than this (stale/duplicate rejection).';

-- Fast "is this file clean?" lookups for gating.
CREATE INDEX idx_file_scan_clean ON file_scan (directus_file_id) WHERE scan_status = 'NO_THREATS_FOUND';
CREATE INDEX idx_file_scan_status ON file_scan (scan_status);
