GRANT SELECT ON content_item, content_type, tag, content_item_tag, content_item_file, content_placement
  TO gm_directus;

GRANT SELECT, INSERT ON submission TO gm_directus;
GRANT SELECT, INSERT ON risk_event TO gm_directus;

GRANT SELECT, UPDATE ON submission TO gm_directus;
GRANT SELECT, INSERT ON content_item TO gm_directus;
GRANT SELECT, INSERT ON content_item_tag TO gm_directus;
GRANT SELECT, INSERT ON audit_event TO gm_directus;
GRANT SELECT ON submission_tag TO gm_directus;