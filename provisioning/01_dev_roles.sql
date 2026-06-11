CREATE ROLE gm_migrator NOLOGIN;

GRANT gm_migrator TO neondb_owner;

GRANT USAGE, CREATE ON SCHEMA public TO gm_migrator;

CREATE ROLE aaron_dev
    WITH LOGIN PASSWORD 'set-a-real-password-at-run-time'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE pierce_dev
    WITH LOGIN PASSWORD 'set-a-real-password-at-run-time'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT gm_migrator TO aaron_dev;

GRANT gm_migrator TO pierce_dev;
