-- V008: Submission form fields for the aligned client submission forms.
--
-- Additive only. Deliberately INDEPENDENT of the file-upload work (submission_file,
-- V007), which is not applied. Nothing here references directus_files or uploads.
--
-- Adds:
--   * updates_consent (+ _at, _notice_version): optional marketing/newsletter
--     opt-in, mirroring the contact_consent record pattern from V003. Kept
--     separate from contact consent — a marketing opt-in must be freely given and
--     is never bundled with the service (review/contact) consent.
--   * preferred_follow_up: Young Adult Initiative — how the submitter would like
--     to be contacted about follow-up (email | phone | video).

-- Updates (marketing) consent
ALTER TABLE submission
    ADD COLUMN updates_consent                boolean NOT NULL DEFAULT false,
    ADD COLUMN updates_consent_at             timestamptz,
    ADD COLUMN updates_consent_notice_version text;

ALTER TABLE submission
    ADD CONSTRAINT submission_updates_consent_record CHECK (
        (
            updates_consent = false
            AND updates_consent_at IS NULL
            AND updates_consent_notice_version IS NULL
        )
        OR
        (
            updates_consent = true
            AND updates_consent_at IS NOT NULL
            AND updates_consent_notice_version IS NOT NULL
        )
    );

COMMENT ON COLUMN submission.updates_consent IS
    'Whether the submitter opted in to receive updates from Gathering Matters. Optional marketing consent, independent of contact_consent.';

COMMENT ON COLUMN submission.updates_consent_notice_version IS
    'Version of the updates-consent notice shown at submission time.';

-- Preferred follow-up method (Young Adult Initiative)
ALTER TABLE submission
    ADD COLUMN preferred_follow_up text;

ALTER TABLE submission
    ADD CONSTRAINT submission_preferred_follow_up_check
        CHECK (preferred_follow_up IS NULL OR preferred_follow_up IN ('email', 'phone', 'video'));

COMMENT ON COLUMN submission.preferred_follow_up IS
    'Young Adult Initiative: submitter''s preferred follow-up method (email | phone | video).';
