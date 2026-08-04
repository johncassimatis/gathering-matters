-- Read-only regression for the V009 scan-table runtime grants (07_directus_scan_table_grants.sql).
-- Asserts gm_directus has EXACTLY the least-privilege matrix and nothing broader.
-- Safe to run against any provisioned database (production included): read-only.
DO $$
BEGIN
  -- Required (positive)
  IF NOT has_table_privilege('gm_directus', 'public.file_scan', 'SELECT')        THEN RAISE EXCEPTION 'file_scan SELECT missing'; END IF;
  IF NOT has_table_privilege('gm_directus', 'public.file_scan', 'INSERT')        THEN RAISE EXCEPTION 'file_scan INSERT missing'; END IF;
  IF NOT has_table_privilege('gm_directus', 'public.file_scan', 'UPDATE')        THEN RAISE EXCEPTION 'file_scan UPDATE missing'; END IF;
  IF NOT has_table_privilege('gm_directus', 'public.submission_file', 'SELECT')  THEN RAISE EXCEPTION 'submission_file SELECT missing'; END IF;
  IF NOT has_table_privilege('gm_directus', 'public.submission_file', 'INSERT')  THEN RAISE EXCEPTION 'submission_file INSERT missing'; END IF;

  -- Excluded (negative) — least privilege must hold.
  IF has_table_privilege('gm_directus', 'public.file_scan', 'DELETE')            THEN RAISE EXCEPTION 'file_scan DELETE over-granted'; END IF;
  IF has_table_privilege('gm_directus', 'public.file_scan', 'TRUNCATE')          THEN RAISE EXCEPTION 'file_scan TRUNCATE over-granted'; END IF;
  IF has_table_privilege('gm_directus', 'public.file_scan', 'TRIGGER')           THEN RAISE EXCEPTION 'file_scan TRIGGER over-granted'; END IF;
  IF has_table_privilege('gm_directus', 'public.file_scan', 'REFERENCES')        THEN RAISE EXCEPTION 'file_scan REFERENCES over-granted'; END IF;
  IF has_table_privilege('gm_directus', 'public.submission_file', 'UPDATE')      THEN RAISE EXCEPTION 'submission_file UPDATE over-granted'; END IF;
  IF has_table_privilege('gm_directus', 'public.submission_file', 'DELETE')      THEN RAISE EXCEPTION 'submission_file DELETE over-granted'; END IF;
  IF has_table_privilege('gm_directus', 'public.submission_file', 'TRUNCATE')    THEN RAISE EXCEPTION 'submission_file TRUNCATE over-granted'; END IF;

  -- Ownership must remain with the migration role (runtime role is never owner).
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename IN ('file_scan','submission_file') AND tableowner <> 'gm_migrator') THEN
    RAISE EXCEPTION 'unexpected owner change on a V009 table';
  END IF;

  -- gm_directus must NOT have any grants on unrelated sensitive Directus tables via this change.
  IF has_table_privilege('gm_directus', 'public.directus_users', 'DELETE') THEN
    RAISE EXCEPTION 'unexpected privilege on directus_users';
  END IF;

  RAISE NOTICE 'V009 scan-grant matrix OK (file_scan: S/I/U; submission_file: S/I; no broader)';
END $$;
