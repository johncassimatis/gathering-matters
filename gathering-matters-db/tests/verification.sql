-- test/verification.sql
-- Invariants that must hold after V2. Every count must be 0.

SELECT count(*) AS tags_without_dimension              FROM tag WHERE dimension IS NULL;
SELECT count(*) AS published_without_privacy_review    FROM content_item WHERE status='published' AND privacy_reviewed_at IS NULL;
SELECT count(*) AS published_without_route             FROM content_item WHERE status='published'
       AND NULLIF(btrim(slug),'') IS NULL AND NULLIF(btrim(external_url),'') IS NULL;
SELECT count(*) AS promoted_without_audit              FROM submission WHERE status='promoted'
       AND (content_item_id IS NULL OR promoted_at IS NULL OR promoted_by IS NULL);
SELECT count(*) AS nonpending_without_review           FROM submission WHERE status NOT IN ('draft','pending') AND reviewed_at IS NULL;
SELECT count(*) AS nondraft_without_consent            FROM submission WHERE status<>'draft' AND consent <> true;
SELECT count(*) AS linked_but_not_promoted             FROM submission WHERE content_item_id IS NOT NULL AND status<>'promoted';

-- Expect uuid_version = 7.
SELECT uuid_extract_version(uuidv7()) AS uuid_version;

-- Audit immutability check (should ERROR, proving the trigger works):
-- UPDATE audit_event SET action='content_published' WHERE true;  -- expect: audit_event rows are immutable

-- Audit summary
SELECT action, count(*) FROM audit_event GROUP BY action ORDER BY action;

-- Contact-consent coherence (added V20260623150000): every count must be 0.
SELECT count(*) AS contact_consent_incoherent FROM submission WHERE
   NOT ((contact_consent = false AND contact_consent_at IS NULL AND contact_consent_notice_version IS NULL)
        OR (contact_consent = true  AND contact_consent_at IS NOT NULL AND contact_consent_notice_version IS NOT NULL));

-- audit_event TRUNCATE must be rejected (uncomment to verify; expect an error, not success):
-- TRUNCATE audit_event;   -- expect: audit_event is append-only (UPDATE/DELETE/TRUNCATE rejected)
