-- V003_20260623141647__keyset_indexes_placement_risk_event.sql
-- Pre-Directus migration.
-- Adds support for deterministic public-feed pagination, curated content placements,
-- intake risk telemetry, and durable contact-consent tracking.

-- Keyset-ready feed indexes
DROP INDEX IF EXISTS idx_content_item_published_feed;
DROP INDEX IF EXISTS idx_content_item_type_published_feed;

CREATE INDEX idx_content_item_published_feed
    ON content_item (published_at DESC, id DESC)
    WHERE status = 'published';

CREATE INDEX idx_content_item_type_published_feed
    ON content_item (content_type_id, published_at DESC, id DESC)
    WHERE status = 'published';


-- Curated content placements
CREATE TABLE content_placement (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    content_item_id  uuid NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    placement        text NOT NULL,
    sort             integer,
    starts_at        timestamptz,
    ends_at          timestamptz,
    date_created     timestamptz NOT NULL DEFAULT now(),
    date_updated     timestamptz,
    UNIQUE (content_item_id, placement),
    CONSTRAINT content_placement_not_blank CHECK (NULLIF(btrim(placement), '') IS NOT NULL),
    CONSTRAINT content_placement_slug_lower CHECK (placement = lower(placement)),
    CONSTRAINT content_placement_window CHECK (
        starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at
    )
);

COMMENT ON TABLE content_placement IS
    'Curated placements for published content, such as idea_generator or home_featured.';

CREATE INDEX idx_content_placement_lookup
    ON content_placement (placement, content_item_id);

-- Public-intake risk telemetry
CREATE TABLE risk_event (
    id                  uuid PRIMARY KEY DEFAULT uuidv7(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    event_type          text NOT NULL,
    submission_id       uuid REFERENCES submission(id) ON DELETE SET NULL,
    ip_hash             text,
    user_agent          text,
    request_fingerprint text,
    details             jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT risk_event_type_check CHECK (event_type IN (
        'submission_received',
        'honeypot_triggered',
        'rate_limited',
        'duplicate_suspected',
        'validation_failed'
    )),
    CONSTRAINT risk_event_details_object CHECK (jsonb_typeof(details) = 'object')
);

COMMENT ON TABLE risk_event IS
    'Public-intake risk telemetry. Stores hashed identifiers only; raw IP addresses and submitter PII must not be stored here.';

COMMENT ON COLUMN risk_event.ip_hash IS
    'HMAC hash of the request IP. The raw IP address is intentionally not stored.';

COMMENT ON COLUMN risk_event.request_fingerprint IS
    'HMAC fingerprint used for duplicate-submission suppression.';

CREATE INDEX idx_risk_event_ip_window
    ON risk_event (ip_hash, created_at DESC)
    WHERE ip_hash IS NOT NULL;

CREATE INDEX idx_risk_event_fingerprint_window
    ON risk_event (request_fingerprint, created_at DESC)
    WHERE request_fingerprint IS NOT NULL;

CREATE INDEX idx_risk_event_submission
    ON risk_event (submission_id, created_at DESC)
    WHERE submission_id IS NOT NULL;

-- Contact consent
ALTER TABLE submission
    ADD COLUMN contact_consent                boolean NOT NULL DEFAULT false,
    ADD COLUMN contact_consent_at             timestamptz,
    ADD COLUMN contact_consent_notice_version text;

ALTER TABLE submission
    ADD CONSTRAINT submission_contact_consent_record CHECK (
        (
            contact_consent = false
            AND contact_consent_at IS NULL
            AND contact_consent_notice_version IS NULL
        )
        OR
        (
            contact_consent = true
            AND contact_consent_at IS NOT NULL
            AND contact_consent_notice_version IS NOT NULL
        )
    );

COMMENT ON COLUMN submission.contact_consent IS
    'Whether the submitter consented to be contacted about the submission.';

COMMENT ON COLUMN submission.contact_consent_notice_version IS
    'Version of the contact-consent notice shown at submission time.';