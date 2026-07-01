-- V005_20260629195805__audit_event_immutable.sql
-- Enforces append-only behavior for audit_event.
--
-- Prerequisite: Must have created audit_event.

-- Reject ordinary application-level UPDATE, DELETE, and TRUNCATE operations.
-- Database owners and similarly privileged roles can still alter or remove this
-- protection. This is an application-integrity control, not tamper-proof storage.
--
-- Fix-forward reversal:
--   DROP TRIGGER IF EXISTS trg_audit_event_immutable_rows ON audit_event;
--   DROP TRIGGER IF EXISTS trg_audit_event_immutable_truncate ON audit_event;
--   DROP FUNCTION IF EXISTS reject_audit_event_mutation();

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_event is append-only (UPDATE/DELETE/TRUNCATE rejected)';
END;
$$;

-- Reject row-level updates and deletes.
CREATE TRIGGER trg_audit_event_immutable_rows
    BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_event_mutation();

-- TRUNCATE does not invoke row-level triggers.
CREATE TRIGGER trg_audit_event_immutable_truncate
    BEFORE TRUNCATE ON audit_event
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_audit_event_mutation();

-- submission_promoted is currently emitted by the promote-submission operation.
--
-- The remaining values allowed by audit_event_action_check are reserved for
-- future workflow instrumentation. Directus Activity covers Studio-originated
-- changes but does not capture direct database writes.