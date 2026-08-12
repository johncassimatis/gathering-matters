-- provisioning/07_directus_studio_field_config.sql
--
-- Directus DATA-MODEL PRESENTATION config — NOT roles/grants, NOT application schema.
-- Adds a "Tags" many-to-many picker to the content_item AND submission edit pages (over the
-- existing content_item_tag / submission_tag junctions from V002, sharing the one tag set)
-- plus friendly name/title dropdowns for the id-reference fields.
--
-- RUN AS the OWNER of the directus_* system tables: gm_directus (or neondb_owner).
-- gm_migrator owns the application tables but NOT directus_fields/directus_relations,
-- so it cannot apply this.
--
-- WHY SQL (and not the Studio): configuring an M2M relation through the Studio/API makes
-- Directus attempt DDL on content_item_tag (ALTER TABLE ... drop constraint) to reconcile
-- the FK. content_item_tag is owned by gm_migrator, and gm_directus is deliberately denied
-- DDL/ownership on application tables (least-privilege split), so the API returns
-- 500 "must be owner of table content_item_tag". Seeding the relation METADATA directly
-- (below) needs no DDL and no constraint change — the junction table is untouched.
--
-- AFTER RUNNING: clear the Directus schema cache so the running process rebuilds its
-- in-memory schema, otherwise queries still use the stale schema:
--     curl -X POST "$PUBLIC_URL/utils/cache/clear" -H "Authorization: Bearer <admin token>"
-- (a Directus restart has the same effect). On a running instance a change made only in
-- these tables is not picked up until the cache is cleared.
--
-- Applied to production 2026-08-11. Idempotent (safe to re-run).

-- 1) content_item <-> tag  M2M, surfaced as the "Tags" chip-picker on content_item. ---------
INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, note, width)
SELECT 'content_item', 'tags', 'm2m', 'list-m2m',
       '{"enableCreate":false,"enableSelect":true,"template":"{{tag_id.name}}"}',
       'related-values', '{"template":"{{tag_id.name}}"}',
       'Topic/Audience/Region tags (M2M over content_item_tag).', 'full'
WHERE NOT EXISTS (
    SELECT 1 FROM directus_fields WHERE collection = 'content_item' AND field = 'tags'
);

-- junction -> content_item side (defines the "tags" alias; deselect deletes the junction row)
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, junction_field, one_deselect_action)
SELECT 'content_item_tag', 'content_item_id', 'content_item', 'tags', 'tag_id', 'delete'
WHERE NOT EXISTS (
    SELECT 1 FROM directus_relations WHERE many_collection = 'content_item_tag' AND many_field = 'content_item_id'
);

-- junction -> tag side (no reverse field on tag)
INSERT INTO directus_relations (many_collection, many_field, one_collection, junction_field, one_deselect_action)
SELECT 'content_item_tag', 'tag_id', 'tag', 'content_item_id', 'nullify'
WHERE NOT EXISTS (
    SELECT 1 FROM directus_relations WHERE many_collection = 'content_item_tag' AND many_field = 'tag_id'
);

-- 2) Friendly dropdowns for id-reference fields (these could also be set in the Studio; ------
--    UPDATE is a no-op if the field-meta row does not exist yet on a fresh instance).
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{name}}"}'
 WHERE collection = 'content_item'     AND field = 'content_type_id';
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{name}}"}'
 WHERE collection = 'content_item_tag' AND field = 'tag_id';
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{title}}"}'
 WHERE collection = 'content_item_tag' AND field = 'content_item_id';

-- 3) Collection display templates (how a row renders when referenced elsewhere). -------------
UPDATE directus_collections SET display_template = '{{name}}'  WHERE collection = 'tag';
UPDATE directus_collections SET display_template = '{{name}}'  WHERE collection = 'content_type';
UPDATE directus_collections SET display_template = '{{title}}' WHERE collection = 'content_item';
UPDATE directus_collections SET display_template = '{{content_item_id.title}} - {{tag_id.name}}',
       icon = 'sell'
 WHERE collection = 'content_item_tag';

-- 4) submission <-> tag  M2M, surfaced as a "Tags" chip-picker on submission (parallels ------
--    content_item, over the existing submission_tag junction from V002). Same shared tag set.
--    gm_directus already has INSERT/DELETE on submission_tag (provisioning/05), so writes work.
INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, note, width)
SELECT 'submission', 'tags', 'm2m', 'list-m2m',
       '{"enableCreate":false,"enableSelect":true,"template":"{{tag_id.name}}"}',
       'related-values', '{"template":"{{tag_id.name}}"}',
       'Topic/Audience/Region tags (M2M over submission_tag).', 'full'
WHERE NOT EXISTS (
    SELECT 1 FROM directus_fields WHERE collection = 'submission' AND field = 'tags'
);

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, junction_field, one_deselect_action)
SELECT 'submission_tag', 'submission_id', 'submission', 'tags', 'tag_id', 'delete'
WHERE NOT EXISTS (
    SELECT 1 FROM directus_relations WHERE many_collection = 'submission_tag' AND many_field = 'submission_id'
);
INSERT INTO directus_relations (many_collection, many_field, one_collection, junction_field, one_deselect_action)
SELECT 'submission_tag', 'tag_id', 'tag', 'submission_id', 'nullify'
WHERE NOT EXISTS (
    SELECT 1 FROM directus_relations WHERE many_collection = 'submission_tag' AND many_field = 'tag_id'
);

UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{name}}"}'
 WHERE collection = 'submission_tag' AND field = 'tag_id';
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{title}}"}'
 WHERE collection = 'submission_tag' AND field = 'submission_id';
-- which content type a submission is promoted to -> name dropdown (M2O to content_type)
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{name}}"}'
 WHERE collection = 'submission' AND field = 'promotion_content_type_id';
UPDATE directus_collections SET display_template = '{{title}}' WHERE collection = 'submission';
UPDATE directus_collections SET display_template = '{{submission_id.title}} - {{tag_id.name}}',
       icon = 'sell'
 WHERE collection = 'submission_tag';

-- NOTE: Moderator write access to submission tags was added 2026-08-11 — create + delete on
-- submission_tag were granted to the 'submission-review' policy (create validated to active tags
-- only), mirroring how 'content-edit-any' covers content_item_tag; read stays via 'submission-read'.
-- Those are Directus permissions (directus_permissions rows) managed in Directus like the rest of
-- the policy model, so they are NOT seeded by this file.

-- ROLLBACK (to fully remove both Tags pickers):
--   DELETE FROM directus_relations WHERE many_collection IN ('content_item_tag','submission_tag');
--   DELETE FROM directus_fields
--     WHERE (collection='content_item' AND field='tags') OR (collection='submission' AND field='tags');
--   then clear the Directus schema cache.
