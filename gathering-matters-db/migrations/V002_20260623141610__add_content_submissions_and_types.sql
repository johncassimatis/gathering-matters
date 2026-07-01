-- V002_20260623141610__add_content_submissions_and_types.sql
-- Adds the core content, submission, and taxonomy model.
-- This migration extends the existing tag table created by the initial schema.

-- Content types
CREATE TABLE content_type (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE,
    description text,
    sort        integer,
    is_active   boolean NOT NULL DEFAULT true,

    CONSTRAINT content_type_slug_lower
        CHECK (slug = lower(slug)),
    CONSTRAINT content_type_slug_not_blank
        CHECK (NULLIF(btrim(slug), '') IS NOT NULL),
    CONSTRAINT content_type_name_not_blank
        CHECK (NULLIF(btrim(name), '') IS NOT NULL)
);

CREATE UNIQUE INDEX uq_content_type_name_lower
    ON content_type (lower(name));

COMMENT ON TABLE content_type IS
    'Controlled vocabulary for canonical content item types. Types may be retired with is_active.';

-- Tag taxonomy
ALTER TABLE tag
    ADD COLUMN dimension text,
    ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Classify any tags that existed before this migration.
-- Keep this mapping complete. The validation block below intentionally fails
-- if an existing tag has not been assigned a dimension.
UPDATE tag
SET dimension = CASE slug
    WHEN 'young-adult' THEN 'audience'
    WHEN 'all-ages' THEN 'audience'
    WHEN 'california' THEN 'region'
    WHEN 'bay-area' THEN 'region'
END
WHERE dimension IS NULL;

DO $$
DECLARE
    missing_slugs text;
BEGIN
    SELECT string_agg(slug, ', ' ORDER BY slug)
    INTO missing_slugs
    FROM tag
    WHERE dimension IS NULL;

    IF missing_slugs IS NOT NULL THEN
        RAISE EXCEPTION
            'Unclassified tag slugs: %',
            missing_slugs;
    END IF;
END;
$$;

ALTER TABLE tag
    ALTER COLUMN dimension SET NOT NULL,
    ADD CONSTRAINT tag_dimension_check
        CHECK (dimension IN ('audience', 'topic', 'region')),
    ADD CONSTRAINT tag_slug_lower
        CHECK (slug = lower(slug)),
    ADD CONSTRAINT tag_slug_not_blank
        CHECK (NULLIF(btrim(slug), '') IS NOT NULL),
    ADD CONSTRAINT tag_name_not_blank
        CHECK (NULLIF(btrim(name), '') IS NOT NULL);

COMMENT ON COLUMN tag.dimension IS
    'Facet used for public filtering. New tags must explicitly choose a dimension.';

COMMENT ON COLUMN tag.is_active IS
    'Inactive tags remain attached to historical records but are unavailable for new classification.';

-- Canonical public content
CREATE TABLE content_item (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    status          text NOT NULL DEFAULT 'draft',
    sort            integer,
    date_created    timestamptz NOT NULL DEFAULT now(),
    date_updated    timestamptz,
    user_created    uuid,
    user_updated    uuid,

    title           text NOT NULL,
    slug            text UNIQUE,
    summary         text,
    body            text,
    content_type_id uuid NOT NULL REFERENCES content_type(id) ON DELETE RESTRICT,
    source          text NOT NULL DEFAULT 'gm_upload',
    author          text,
    external_url    text,
    featured        boolean NOT NULL DEFAULT false,
    published_at    timestamptz,

    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

    search_tsv tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'C')
    ) STORED,

    CONSTRAINT content_item_status_check
        CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT content_item_source_check
        CHECK (source IN (
            'gm_upload',
            'listening_program',
            'young_adult_initiative',
            'web'
        )),
    CONSTRAINT content_item_title_not_blank
        CHECK (NULLIF(btrim(title), '') IS NOT NULL),
    CONSTRAINT content_item_slug_lower
        CHECK (slug IS NULL OR slug = lower(slug)),
    CONSTRAINT content_item_slug_not_blank
        CHECK (slug IS NULL OR NULLIF(btrim(slug), '') IS NOT NULL),
    CONSTRAINT content_item_published_at
        CHECK (status <> 'published' OR published_at IS NOT NULL),
    CONSTRAINT content_item_published_route
        CHECK (
            status <> 'published'
            OR NULLIF(btrim(slug), '') IS NOT NULL
            OR NULLIF(btrim(external_url), '') IS NOT NULL
        )
);

COMMENT ON TABLE content_item IS
    'Canonical shared content record. Public reads must require published status and published_at <= now().';

COMMENT ON COLUMN content_item.metadata IS
    'Non-queryable item-specific attributes. Do not use this column for core relational fields.';

COMMENT ON COLUMN content_item.search_tsv IS
    'Stored weighted full-text search vector for title, summary, and body.';

-- Private submission intake
CREATE TABLE submission (
    id                       uuid PRIMARY KEY DEFAULT uuidv7(),
    status                   text NOT NULL DEFAULT 'pending',
    sort                     integer,
    date_created             timestamptz NOT NULL DEFAULT now(),
    date_updated             timestamptz,
    user_created             uuid,
    user_updated             uuid,

    source                   text NOT NULL,
    audience                 text,
    title                    text,
    body                     text NOT NULL,

    submitter_name           text,
    submitter_email          text,
    submitter_phone          text,
    submitter_age_range      text,

    consent                  boolean NOT NULL DEFAULT false,
    consent_at               timestamptz,
    consent_notice_version   text,

    moderation_notes         text,
    reviewed_by              uuid,
    reviewed_at              timestamptz,

    promotion_content_type_id uuid REFERENCES content_type(id) ON DELETE RESTRICT,
    content_item_id           uuid REFERENCES content_item(id) ON DELETE RESTRICT,

    CONSTRAINT submission_status_check
        CHECK (status IN (
            'draft',
            'pending',
            'approved',
            'rejected',
            'promoted',
            'archived'
        )),
    CONSTRAINT submission_source_check
        CHECK (source IN (
            'listening_program',
            'young_adult_initiative'
        )),
    CONSTRAINT submission_audience_check
        CHECK (audience IS NULL OR audience IN ('all_age', 'young_adult')),
    CONSTRAINT submission_body_not_blank
        CHECK (NULLIF(btrim(body), '') IS NOT NULL),
    CONSTRAINT submission_consent_gate
        CHECK (status = 'draft' OR consent = true),
    CONSTRAINT submission_consent_record
        CHECK (
            (
                consent = false
                AND consent_at IS NULL
                AND consent_notice_version IS NULL
            )
            OR
            (
                consent = true
                AND consent_at IS NOT NULL
                AND consent_notice_version IS NOT NULL
            )
        ),
    CONSTRAINT submission_content_item_state
        CHECK (
            (status = 'promoted' AND content_item_id IS NOT NULL)
            OR
            (status <> 'promoted' AND content_item_id IS NULL)
        ),
    CONSTRAINT submission_promotion_ready
        CHECK (
            status <> 'promoted'
            OR (
                promotion_content_type_id IS NOT NULL
                AND NULLIF(btrim(title), '') IS NOT NULL
            )
        )
);

COMMENT ON TABLE submission IS
    'Private intake for Listening Program and Young Adult Initiative submissions. Submitter data and moderation notes must never be exposed through public APIs.';

COMMENT ON COLUMN submission.content_item_id IS
    'Canonical content record created by the promotion workflow. Present only when status is promoted.';

COMMENT ON COLUMN submission.promotion_content_type_id IS
    'Content type selected by a reviewer before transactional promotion.';

-- Content and submission tags
CREATE TABLE content_item_tag (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    content_item_id uuid NOT NULL REFERENCES content_item(id) ON DELETE CASCADE,
    tag_id          uuid NOT NULL REFERENCES tag(id) ON DELETE RESTRICT,

    UNIQUE (content_item_id, tag_id)
);

CREATE TABLE submission_tag (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    submission_id uuid NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
    tag_id        uuid NOT NULL REFERENCES tag(id) ON DELETE RESTRICT,

    UNIQUE (submission_id, tag_id)
);

-- Query indexes
CREATE INDEX idx_content_item_published_feed
    ON content_item (published_at DESC)
    WHERE status = 'published';

CREATE INDEX idx_content_item_type_published_feed
    ON content_item (content_type_id, published_at DESC)
    WHERE status = 'published';

CREATE INDEX idx_content_item_search
    ON content_item USING gin (search_tsv);

CREATE INDEX idx_submission_pending
    ON submission (date_created)
    WHERE status = 'pending';

CREATE INDEX idx_content_item_tag_tag
    ON content_item_tag (tag_id);

CREATE INDEX idx_submission_tag_tag
    ON submission_tag (tag_id);

CREATE UNIQUE INDEX uq_submission_content_item
    ON submission (content_item_id)
    WHERE content_item_id IS NOT NULL;
