-- Runtime grants for the V009 scan tables (file_scan, submission_file).
--
-- V009 is owned by gm_migrator; migration ownership does NOT grant the Directus
-- runtime role (gm_directus) any access, so these grants must be applied AFTER
-- V009 is migrated (same as the other content-table grants in 04/05). Without
-- them the Directus app hits "permission denied for table file_scan" the first
-- time any scan path touches the table (gm-intake insert, gm-scan-consumer
-- select/update, gm-publish-gate/gm-library/gm-review reads).
--
-- Least privilege (mirrors the existing convention): no DELETE (the FK
-- ON DELETE CASCADE from directus_files/submission removes child rows without a
-- direct child-table DELETE by the runtime role), no TRUNCATE, no REFERENCES, no
-- TRIGGER, no ownership, nothing to PUBLIC. Idempotent (GRANT re-run is a no-op).
--
-- Run manually after Directus bootstrap + V009, as with 04/05.

-- Preflight: fail clearly if the role or tables are absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gm_directus') THEN
    RAISE EXCEPTION 'role gm_directus does not exist; run 02_directus_role_setup.sql first';
  END IF;
  IF to_regclass('public.file_scan') IS NULL OR to_regclass('public.submission_file') IS NULL THEN
    RAISE EXCEPTION 'V009 tables missing (file_scan/submission_file); apply migration V009 first';
  END IF;
END $$;

-- file_scan: intake inserts PENDING; the scan consumer selects (FOR UPDATE) and
-- updates the result; the gating/reviewer paths read scan_status/origin.
GRANT SELECT, INSERT, UPDATE ON TABLE public.file_scan TO gm_directus;

-- submission_file: intake inserts the association; the reviewer endpoint reads it.
-- No update or delete path (removal cascades from submission).
GRANT SELECT, INSERT ON TABLE public.submission_file TO gm_directus;

-- Self-verify: exact least-privilege matrix must hold (fail closed on drift).
DO $$
BEGIN
  IF NOT (has_table_privilege('gm_directus', 'public.file_scan', 'SELECT')
      AND has_table_privilege('gm_directus', 'public.file_scan', 'INSERT')
      AND has_table_privilege('gm_directus', 'public.file_scan', 'UPDATE')
      AND has_table_privilege('gm_directus', 'public.submission_file', 'SELECT')
      AND has_table_privilege('gm_directus', 'public.submission_file', 'INSERT')) THEN
    RAISE EXCEPTION 'V009 runtime grants incomplete for gm_directus';
  END IF;
  IF has_table_privilege('gm_directus', 'public.file_scan', 'DELETE')
     OR has_table_privilege('gm_directus', 'public.file_scan', 'TRUNCATE')
     OR has_table_privilege('gm_directus', 'public.file_scan', 'TRIGGER')
     OR has_table_privilege('gm_directus', 'public.file_scan', 'REFERENCES')
     OR has_table_privilege('gm_directus', 'public.submission_file', 'DELETE')
     OR has_table_privilege('gm_directus', 'public.submission_file', 'UPDATE')
     OR has_table_privilege('gm_directus', 'public.submission_file', 'TRUNCATE') THEN
    RAISE EXCEPTION 'V009 runtime grants over-privileged for gm_directus';
  END IF;
END $$;
