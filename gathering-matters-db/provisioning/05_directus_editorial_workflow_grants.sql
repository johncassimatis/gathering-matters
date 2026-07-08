GRANT UPDATE ON TABLE public.content_item TO gm_directus;
GRANT DELETE ON TABLE public.content_item_tag TO gm_directus;
GRANT INSERT, DELETE ON TABLE public.content_item_file TO gm_directus;
GRANT INSERT, UPDATE, DELETE ON TABLE public.content_placement TO gm_directus;
GRANT INSERT, DELETE ON TABLE public.submission_tag TO gm_directus;
-- tag / content_type: retire via is_active = false (archive, not delete); DELETE intentionally omitted.
GRANT INSERT, UPDATE ON TABLE public.tag          TO gm_directus;
GRANT INSERT, UPDATE ON TABLE public.content_type TO gm_directus;
