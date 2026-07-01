-- Run manually after Directus bootstrap succeeds.
GRANT REFERENCES ON TABLE public.directus_users, public.directus_files
TO gm_migrator;