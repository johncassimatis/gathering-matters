-- V004_20260629194749__directus_relations_privacy_audit_files.sql
-- Adds Directus-backed user and file references, editorial review fields,
-- content attachments, and workflow audit storage.
--
-- Prerequisite: Directus must be bootstrapped in the target database.
-- directus_users and directus_files must exist before this migration runs.

-- Fail before making schema changes when required Directus tables are absent.
DO $$
BEGIN
    IF to_regclass('public.directus_users') IS NULL
       OR to_regclass('public.directus_files') IS NULL THEN
        RAISE EXCEPTION
          'directus_users / directus_files not found. Bootstrap Directus before running this migration.';
    END IF;
END $$;

-- Content review, editorial, and featured-file references
ALTER TABLE content_item
    ADD COLUMN editorial_notes     text,
    ADD COLUMN privacy_reviewed_at timestamptz,
    ADD COLUMN privacy_reviewed_by uuid,
    ADD COLUMN featured_image_id   uuid;

ALTER TABLE content_item
    ADD CONSTRAINT content_item_privacy_review_record CHECK (
        (privacy_reviewed_at IS NULL     AND privacy_reviewed_by IS NULL)
        OR
        (privacy_reviewed_at IS NOT NULL AND privacy_reviewed_by IS NOT NULL)
    ),
    ADD CONSTRAINT content_item_publish_requires_privacy_review CHECK (
        status <> 'published' OR privacy_reviewed_at IS NOT NULL
    );

-- Author references may be cleared when an account is removed.
-- Privacy-review accountability is retained.
ALTER TABLE content_item
    ADD CONSTRAINT fk_content_item_user_created
        FOREIGN KEY (user_created) REFERENCES directus_users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_content_item_user_updated
        FOREIGN KEY (user_updated) REFERENCES directus_users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_content_item_privacy_reviewed_by
        FOREIGN KEY (privacy_reviewed_by) REFERENCES directus_users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_content_item_featured_image
        FOREIGN KEY (featured_image_id) REFERENCES directus_files(id) ON DELETE SET NULL;

COMMENT ON COLUMN content_item.editorial_notes IS 'Private editor-only notes. Never returned by public endpoints.';
COMMENT ON COLUMN content_item.privacy_reviewed_at IS 'Required before status may become published. Applies to all content.';
COMMENT ON COLUMN content_item.featured_image_id IS 'Primary image relationship into directus_files.';

-- Submission review and promotion accountability
ALTER TABLE submission
    ADD COLUMN promoted_at timestamptz,
    ADD COLUMN promoted_by uuid;

ALTER TABLE submission
    ADD CONSTRAINT submission_review_record CHECK (
        (reviewed_at IS NULL AND reviewed_by IS NULL)
        OR
        (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    ),
    ADD CONSTRAINT submission_nonpending_requires_review CHECK (
        status IN ('draft', 'pending') OR reviewed_at IS NOT NULL
    ),
    ADD CONSTRAINT submission_promotion_audit_record CHECK (
        (promoted_at IS NULL AND promoted_by IS NULL)
        OR
        (promoted_at IS NOT NULL AND promoted_by IS NOT NULL)
    ),
    ADD CONSTRAINT submission_promoted_requires_audit CHECK (
        status <> 'promoted' OR promoted_at IS NOT NULL
    );

-- Review and promotion references are restricted to preserve accountability.
ALTER TABLE submission
    ADD CONSTRAINT fk_submission_user_created
        FOREIGN KEY (user_created) REFERENCES directus_users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_submission_user_updated
        FOREIGN KEY (user_updated) REFERENCES directus_users(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_submission_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES directus_users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_submission_promoted_by
        FOREIGN KEY (promoted_by) REFERENCES directus_users(id) ON DELETE RESTRICT;

COMMENT ON COLUMN submission.promoted_at IS 'Set transactionally by the promote-submission operation.';

-- Content attachments and downloads
CREATE TABLE content_item_file (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    content_item_id  uuid NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    directus_file_id uuid NOT NULL REFERENCES directus_files(id) ON DELETE RESTRICT,
    label            text,
    sort             integer,
    is_download      boolean NOT NULL DEFAULT true,
    UNIQUE (content_item_id, directus_file_id)
);
COMMENT ON TABLE content_item_file IS 'Files attached to content items via directus_files.';

-- Workflow audit trail
--
-- The promotion operation writes directly and bypasses the Directus activity
-- feed. The following migration enforces audit-row immutability.
CREATE TABLE audit_event (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    actor_type      text NOT NULL,
    actor_user_id   uuid REFERENCES directus_users(id) ON DELETE RESTRICT,
    action          text NOT NULL,
    submission_id   uuid REFERENCES submission(id)   ON DELETE RESTRICT,
    content_item_id uuid REFERENCES content_item(id) ON DELETE RESTRICT,
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT audit_event_actor_type_check CHECK (actor_type IN ('user','public','system')),
    CONSTRAINT audit_event_actor_consistency CHECK (
        (actor_type = 'user' AND actor_user_id IS NOT NULL)
        OR
        (actor_type IN ('public','system') AND actor_user_id IS NULL)
    ),
    CONSTRAINT audit_event_action_check CHECK (action IN (
        'submission_created',
        'submission_reviewed',
        'submission_approved',
        'submission_rejected',
        'submission_promoted',
        'content_privacy_reviewed',
        'content_published',
        'content_archived'
    )),
    CONSTRAINT audit_event_target_check CHECK (
        submission_id IS NOT NULL OR content_item_id IS NOT NULL
    ),
    CONSTRAINT audit_event_metadata_no_pii CHECK (jsonb_typeof(metadata) = 'object')
);
COMMENT ON TABLE audit_event IS
    'Append-only workflow audit (immutability enforced by trigger). Non-PII metadata only.';

-- Supporting indexes
CREATE INDEX idx_content_item_file_item_sort  ON content_item_file (content_item_id, sort, id);
CREATE INDEX idx_content_item_file_file       ON content_item_file (directus_file_id);
CREATE INDEX idx_content_item_featured_image  ON content_item (featured_image_id) WHERE featured_image_id IS NOT NULL;
CREATE INDEX idx_submission_promoted_at       ON submission (promoted_at DESC) WHERE promoted_at IS NOT NULL;
CREATE INDEX idx_audit_event_submission       ON audit_event (submission_id, created_at DESC)   WHERE submission_id IS NOT NULL;
CREATE INDEX idx_audit_event_content_item     ON audit_event (content_item_id, created_at DESC) WHERE content_item_id IS NOT NULL;
CREATE INDEX idx_audit_event_action_created   ON audit_event (action, created_at DESC);