-- Durable audit records for automated test runs.
-- Test data may be removed; these run-level records remain.

CREATE TABLE test_run_audit (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    run_id      uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    event       text NOT NULL,
    service     text NOT NULL DEFAULT 'gm-test-runner',
    commit_sha  text,
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT test_run_audit_event_check CHECK (event IN (
        'started',
        'seeded',
        'tests_passed',
        'tests_failed',
        'cleaned',
        'cleanup_failed'
    )),
    CONSTRAINT test_run_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE test_run_audit IS
    'Append-only, non-PII audit of automated test runs. Test rows are cleaned separately.';

CREATE INDEX idx_test_run_audit_run_created
    ON test_run_audit (run_id, created_at);

CREATE OR REPLACE FUNCTION reject_test_run_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'test_run_audit is append-only (UPDATE/DELETE/TRUNCATE rejected)';
END;
$$;

CREATE TRIGGER trg_test_run_audit_immutable_rows
    BEFORE UPDATE OR DELETE ON test_run_audit
    FOR EACH ROW
    EXECUTE FUNCTION reject_test_run_audit_mutation();

CREATE TRIGGER trg_test_run_audit_immutable_truncate
    BEFORE TRUNCATE ON test_run_audit
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_test_run_audit_mutation();
