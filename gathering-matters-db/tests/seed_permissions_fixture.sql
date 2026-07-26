-- gathering-matters-db/tests/seed_permissions_fixture.sql
-- =============================================================================
-- Directus role/permission validation fixture  (SEED)
-- DataGrip-safe version with real UUIDs inlined.
-- =============================================================================
-- Purpose: seed a small, surgically-removable set of boundary rows so a
--          Directus role/permission model can be validated.
--
-- SAFETY / REMOVABILITY CONTRACT
--   * Every removable row carries the literal marker "TESTSEED_" in a human
--     column or the fake email domain "@testseed.invalid".
--   * All submitter PII is FAKE.
--   * audit_event is intentionally NOT seeded.
--
-- RE-RUNNING:
--   This seed is NOT idempotent. Run teardown first if you need to re-seed.
-- =============================================================================

BEGIN;

-- --- Preflight: fail loudly if the three accounts do not exist ----------------

CREATE TEMP TABLE _seed_ids (
    role text PRIMARY KEY,
    id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _seed_ids (role, id) VALUES
    ('vol1', CAST('933d4bc4-b0e2-471d-8558-4a4bb94e11af' AS uuid)),
    ('vol2', CAST('e216bf8e-8e67-48a3-ae16-2201e60be564' AS uuid)),
    ('reviewer', CAST('ea391a0c-df0d-4284-a265-57b6a889cf8a' AS uuid));

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(s.role, ', ' ORDER BY s.role)
    INTO missing
    FROM _seed_ids s
    LEFT JOIN directus_users u ON u.id = s.id
    WHERE u.id IS NULL;

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            'Seed aborted: no directus_users row for: %. Create the Contributor accounts / reviewer and use their real ids.',
            missing;
    END IF;
END $$;

-- --- 1. Content type ---------------------------------------------------------

INSERT INTO content_type (name, slug, description, is_active)
VALUES (
    'TESTSEED_Story',
    'testseed-story',
    'TESTSEED content type for permission validation.',
    true
);

-- --- 2. Tags ----------------------------------------------------------------

INSERT INTO tag (name, slug, dimension, is_active)
VALUES
    ('TESTSEED_Topic_Community',      'testseed-topic-community',      'topic',    true),
    ('TESTSEED_Audience_YoungAdult',  'testseed-audience-young-adult', 'audience', true),
    ('TESTSEED_Region_BayArea',       'testseed-region-bay-area',      'region',   true),
    ('TESTSEED_Topic_Retired',        'testseed-topic-retired',        'topic',    false);

-- --- 3. Content items --------------------------------------------------------

INSERT INTO content_item
    (
        status,
        title,
        slug,
        summary,
        body,
        content_type_id,
        source,
        published_at,
        privacy_reviewed_at,
        privacy_reviewed_by,
        editorial_notes,
        user_created
    )
VALUES
    -- visible published row
    (
        'published',
        'TESTSEED_Published_Visible',
        'testseed-published-visible',
        'TESTSEED visible summary',
        'TESTSEED visible body.',
        (SELECT id FROM content_type WHERE slug = 'testseed-story'),
        'gm_upload',
        now() - interval '7 days',
        now() - interval '8 days',
        CAST('ea391a0c-df0d-4284-a265-57b6a889cf8a' AS uuid),
        'TESTSEED_ editor-only note: must be hidden from public and Contributor field reads.',
        NULL
    ),

    -- draft owned by test-volunteer 1
    (
        'draft',
        'TESTSEED_Draft_Vol1',
        'testseed-draft-vol1',
        NULL,
        'TESTSEED draft body (owner vol1).',
        (SELECT id FROM content_type WHERE slug = 'testseed-story'),
        'gm_upload',
        NULL,
        NULL,
        NULL,
        NULL,
        CAST('933d4bc4-b0e2-471d-8558-4a4bb94e11af' AS uuid)
    ),

    -- draft owned by test-volunteer 2
    (
        'draft',
        'TESTSEED_Draft_Vol2',
        'testseed-draft-vol2',
        NULL,
        'TESTSEED draft body (owner vol2).',
        (SELECT id FROM content_type WHERE slug = 'testseed-story'),
        'gm_upload',
        NULL,
        NULL,
        NULL,
        NULL,
        CAST('e216bf8e-8e67-48a3-ae16-2201e60be564' AS uuid)
    ),

    -- archived row
    (
        'archived',
        'TESTSEED_Archived',
        'testseed-archived',
        NULL,
        'TESTSEED archived body.',
        (SELECT id FROM content_type WHERE slug = 'testseed-story'),
        'gm_upload',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    ),

    -- future published row, should be hidden by published_at <= now filters
    (
        'published',
        'TESTSEED_Published_Future',
        'testseed-published-future',
        NULL,
        'TESTSEED future-dated body.',
        (SELECT id FROM content_type WHERE slug = 'testseed-story'),
        'gm_upload',
        now() + interval '30 days',
        now() - interval '1 day',
        CAST('ea391a0c-df0d-4284-a265-57b6a889cf8a' AS uuid),
        NULL,
        NULL
    );

-- --- 4. Content item tag junctions ------------------------------------------

INSERT INTO content_item_tag (content_item_id, tag_id)
SELECT ci.id, t.id
FROM content_item ci
JOIN tag t
    ON t.slug IN (
        'testseed-topic-community',
        'testseed-region-bay-area',
        'testseed-topic-retired'
    )
WHERE ci.slug = 'testseed-published-visible'

UNION ALL

SELECT ci.id, t.id
FROM content_item ci
JOIN tag t
    ON t.slug = 'testseed-audience-young-adult'
WHERE ci.slug = 'testseed-draft-vol1';

-- --- 5. Submissions ----------------------------------------------------------

INSERT INTO submission
    (
        status,
        source,
        audience,
        title,
        body,
        submitter_name,
        submitter_email,
        submitter_phone,
        submitter_age_range,
        consent,
        consent_at,
        consent_notice_version,
        contact_consent,
        contact_consent_at,
        contact_consent_notice_version,
        moderation_notes
    )
VALUES
    -- draft, consent not yet given
    (
        'draft',
        'listening_program',
        'all_age',
        'TESTSEED_Submission_Draft',
        'TESTSEED draft submission body.',
        'TESTSEED_Submitter_Draft',
        'draft@testseed.invalid',
        'TESTSEED-phone-000',
        'TESTSEED-age',
        false,
        NULL,
        NULL,
        false,
        NULL,
        NULL,
        NULL
    ),

    -- pending, full consent and contact consent
    (
        'pending',
        'young_adult_initiative',
        'young_adult',
        'TESTSEED_Submission_Pending',
        'TESTSEED pending submission body.',
        'TESTSEED_Submitter_Pending',
        'pending@testseed.invalid',
        'TESTSEED-phone-001',
        'TESTSEED-age',
        true,
        now(),
        'TESTSEED-consent-v1',
        true,
        now(),
        'TESTSEED-contact-v1',
        'TESTSEED_ moderation note: reviewer-only, must be hidden from Contributor.'
    );

COMMIT;

-- Optional sanity read after running:
-- SELECT 'content_type' AS tbl, count(*) FROM content_type WHERE name LIKE 'TESTSEED\_%' ESCAPE '\'
-- UNION ALL SELECT 'tag', count(*) FROM tag WHERE name LIKE 'TESTSEED\_%' ESCAPE '\'
-- UNION ALL SELECT 'content_item', count(*) FROM content_item WHERE title LIKE 'TESTSEED\_%' ESCAPE '\'
-- UNION ALL SELECT 'submission', count(*) FROM submission WHERE submitter_email LIKE '%@testseed.invalid';