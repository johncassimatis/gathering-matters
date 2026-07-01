CREATE ROLE gm_directus LOGIN PASSWORD 'set-a-real-password-at-run-time';

GRANT CONNECT ON DATABASE neondb TO gm_directus;
GRANT USAGE, CREATE ON SCHEMA public TO gm_directus;