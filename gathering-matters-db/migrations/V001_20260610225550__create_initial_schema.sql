-- Add your migration SQL here
CREATE TABLE tag (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    name          text NOT NULL,
    slug          text NOT NULL UNIQUE,
    date_created  timestamptz NOT NULL DEFAULT now(),
    date_updated  timestamptz,
    user_created  uuid,
    user_updated  uuid
);

COMMENT ON TABLE tag IS 'Tags used to categorize Gathering Matters content and submissions.';
