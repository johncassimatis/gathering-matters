-- Run manually as neondb_owner after V006 is applied.
-- Set the password outside the repository, for example with psql \password.

CREATE ROLE gm_test_runner
    WITH LOGIN
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;

GRANT CONNECT ON DATABASE neondb TO gm_test_runner;
GRANT USAGE ON SCHEMA public TO gm_test_runner;

-- The seed needs only the Directus user id for privacy_reviewed_by.
GRANT SELECT (id) ON public.directus_users TO gm_test_runner;

GRANT SELECT, INSERT, DELETE ON public.content_type TO gm_test_runner;
GRANT SELECT, INSERT, DELETE ON public.content_item TO gm_test_runner;
GRANT SELECT, DELETE ON public.content_item_tag TO gm_test_runner;
GRANT SELECT, DELETE ON public.content_item_file TO gm_test_runner;
GRANT SELECT, DELETE ON public.submission_tag TO gm_test_runner;
GRANT SELECT, DELETE ON public.submission TO gm_test_runner;
GRANT SELECT, DELETE ON public.risk_event TO gm_test_runner;

-- Test runs must never mutate workflow audit records.
GRANT SELECT ON public.audit_event TO gm_test_runner;
GRANT SELECT, INSERT ON public.test_run_audit TO gm_test_runner;

-- Allow Directus to expose the retained run history as a read-only collection.
GRANT SELECT ON public.test_run_audit TO gm_directus;
