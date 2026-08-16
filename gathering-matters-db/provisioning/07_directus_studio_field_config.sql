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

-- NOTE (Directus permissions — managed in Directus, NOT seeded here): the new 'tags' alias field is
-- only visible/editable to a role whose content_item read AND update field-lists include it. Added
-- 2026-08-11: 'tags' appended to content-read-editorial (read) and content-edit-any (update) so
-- Editors and Publishers see/use it. Junction read + create/delete on content_item_tag, and tag read,
-- were already granted by content-read-editorial / content-edit-any. (Admins always saw it.)

-- 2) Friendly M2O dropdowns for id-reference fields. IMPORTANT: a select-dropdown-m2o field is
--    only EDITABLE in the Studio when its relation is registered in directus_relations — an FK
--    constraint alone is NOT enough (the picker cannot load options, so the field is read-only).
--    So seed the standalone M2O relation rows too. (The content_item_tag / submission_tag junction
--    fields get their relation rows from sections 1 and 4.)
INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'content_item','content_type_id','content_type'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection='content_item' AND many_field='content_type_id');

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
-- which content type a submission is promoted to -> name dropdown (M2O to content_type).
-- Seed the relation row (see section 2 note) so the dropdown is editable, not just the interface.
INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'submission','promotion_content_type_id','content_type'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection='submission' AND many_field='promotion_content_type_id');
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{name}}"}'
 WHERE collection = 'submission' AND field = 'promotion_content_type_id';
UPDATE directus_collections SET display_template = '{{title}}' WHERE collection = 'submission';
UPDATE directus_collections SET display_template = '{{submission_id.title}} - {{tag_id.name}}',
       icon = 'sell'
 WHERE collection = 'submission_tag';

-- 5) Privacy-review sign-off on content_item. Publishing is gated by a DB constraint ----------
--    (content_item_publish_requires_privacy_review, from V004): status='published' requires
--    privacy_reviewed_at IS NOT NULL (and _at/_by must be set together). A Publisher records the
--    review with the one-click Flow button "Mark as Privacy Reviewed" (see NOTE below), which
--    stamps privacy_reviewed_at=now and privacy_reviewed_by=the current user. The two fields are
--    shown READ-ONLY on the form so the button is the only setter.
UPDATE directus_fields SET interface = 'datetime', display = 'datetime', readonly = true
 WHERE collection = 'content_item' AND field = 'privacy_reviewed_at';
INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'content_item','privacy_reviewed_by','directus_users'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection='content_item' AND many_field='privacy_reviewed_by');
UPDATE directus_fields SET interface = 'select-dropdown-m2o', display = 'related-values',
       display_options = '{"template":"{{first_name}} {{last_name}}"}', readonly = true
 WHERE collection = 'content_item' AND field = 'privacy_reviewed_by';

-- NOTE (Directus permissions + a Flow — managed in Directus, NOT seeded by this file). For the
-- privacy-review sign-off, added 2026-08-11:
--   * publisher-content-update: READ on content_item fields privacy_reviewed_at, privacy_reviewed_by
--     (so Publishers can SEE the review fields; Editors deliberately still cannot).
--   * publisher-content-update: READ on directus_users filtered to id = $CURRENT_USER
--     (id, first_name, last_name) so the reviewer's name renders for the Publisher.
--   * a manual Flow "Mark as Privacy Reviewed" (trigger=manual, collections=[content_item],
--     location=both, accountability=all, requireConfirmation): op1 (exec) returns
--     { at: new Date().toISOString() }; op2 (item-update) sets privacy_reviewed_at={{stamp.at}},
--     privacy_reviewed_by={{$accountability.user}} on key {{$trigger.body.keys[0]}}. Recreate it when
--     rebuilding (flows live in directus_flows/operations). `location:both` makes the button appear on
--     the item page (not just the list). A Publisher runs it; an Editor cannot write those fields.
--   * publisher-content-update also grants READ on that directus_flows row (filter id = the flow) and
--     on directus_operations (filter flow = the flow) — a non-admin must be able to READ a manual flow
--     to SEE its button, exactly as flow-read-promotion does for the Moderator's Promote button.

-- NOTE (Directus permissions — managed in Directus, NOT seeded by this file). For the Moderator to
-- actually USE the submission pickers, these were added 2026-08-11:
--   * submission-review: create + delete on submission_tag (create validated to active tags only),
--     mirroring how 'content-edit-any' covers content_item_tag.
--   * submission-read:   read on content_type (id,name,slug,is_active) — so the promote-to-type
--     dropdown can load its options and show the current value.
--   * added 'tags' to the submission READ field-list (submission-read) and the submission UPDATE
--     field-list (submission-review).
-- Lessons for any relational field given to a non-admin role: (a) the alias/relation field must be
-- in the parent collection's read AND update field-lists for that role, and (b) the role must have
-- READ on the RELATED collection, or the picker renders empty / read-only for that user.

-- ROLLBACK (to fully remove both Tags pickers):
--   DELETE FROM directus_relations WHERE many_collection IN ('content_item_tag','submission_tag');
--   DELETE FROM directus_fields
--     WHERE (collection='content_item' AND field='tags') OR (collection='submission' AND field='tags');
--   then clear the Directus schema cache.
