-- gathering-matters-db/tests/teardown_permissions_fixture.sql
-- =============================================================================
-- Directus role/permission validation fixture  (TEARDOWN)
-- =============================================================================
-- Removes ONLY rows created by seed_permissions_fixture.sql, matched by their
-- markers:
--     content_type / tag / content_item -> name/title LIKE 'TESTSEED_%'
--     submission                        -> submitter_email LIKE '%@testseed.invalid'
--
-- The '_' in a LIKE pattern is a single-char wildcard, so it is escaped below
-- (LIKE 'TESTSEED\_%' ESCAPE '\') to match the literal marker exactly. Because
-- no production row begins with "TESTSEED" or uses the .invalid domain, this is
-- surgical: zero chance of catching real rows.
--
-- IDEMPOTENT: safe to run repeatedly. Deletes of already-absent rows are no-ops.
--
-- FK-SAFE ORDER (children/junctions before parents):
--   content_item_tag, submission_tag  ->  content_item  ->  submission
--   ->  tag  ->  content_type
--   (content_item_tag.tag_id and content_type refs are ON DELETE RESTRICT, so
--    junctions and content_items must go before tags / content_type.)
--
-- DOES NOT delete directus_users: :vol1_id / :vol2_id / :reviewer_id are real
-- accounts you created by hand. This script did not create them and must not
-- remove them.
--
-- AUDIT CAVEAT: audit_event is append-only (V005 trigger) and references
-- submission + content_item with ON DELETE RESTRICT. This fixture never seeds
-- audit_event, so normal teardown is unaffected. HOWEVER, if you run a real
-- promotion/audit test that writes an audit_event row pointing at one of these
-- TESTSEED rows, that content_item/submission can no longer be deleted (the
-- RESTRICT will block it, by design). Run promotion/audit tests against
-- disposable data you are willing to keep, not against these removable rows.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Junctions first (content_item_tag.tag_id is ON DELETE RESTRICT).
DELETE FROM content_item_tag
WHERE content_item_id IN (SELECT id FROM content_item WHERE title LIKE 'TESTSEED\_%' ESCAPE '\')
   OR tag_id          IN (SELECT id FROM tag          WHERE name  LIKE 'TESTSEED\_%' ESCAPE '\');

DELETE FROM submission_tag
WHERE submission_id IN (SELECT id FROM submission WHERE submitter_email LIKE '%@testseed.invalid');

-- 2. Content items (must precede content_type delete: FK ON DELETE RESTRICT).
DELETE FROM content_item
WHERE title LIKE 'TESTSEED\_%' ESCAPE '\';

-- 3. Submissions (submission_tag already cleared; cascade would also cover it).
DELETE FROM submission
WHERE submitter_email LIKE '%@testseed.invalid';

-- 4. Tags (safe now that all TESTSEED junctions are gone).
DELETE FROM tag
WHERE name LIKE 'TESTSEED\_%' ESCAPE '\';

-- 5. Content type last (safe now that all TESTSEED content items are gone).
DELETE FROM content_type
WHERE name LIKE 'TESTSEED\_%' ESCAPE '\';

COMMIT;

-- Verify empty (every count should be 0). Uncomment to check:
-- SELECT 'content_type' AS t, count(*) FROM content_type WHERE name LIKE 'TESTSEED\_%' ESCAPE '\'
-- UNION ALL SELECT 'tag',              count(*) FROM tag              WHERE name  LIKE 'TESTSEED\_%' ESCAPE '\'
-- UNION ALL SELECT 'content_item',     count(*) FROM content_item     WHERE title LIKE 'TESTSEED\_%' ESCAPE '\'
-- UNION ALL SELECT 'content_item_tag', count(*) FROM content_item_tag ct
--                    WHERE ct.content_item_id NOT IN (SELECT id FROM content_item)  -- (defensive)
-- UNION ALL SELECT 'submission',       count(*) FROM submission       WHERE submitter_email LIKE '%@testseed.invalid';
