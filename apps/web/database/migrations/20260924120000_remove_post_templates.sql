-- Post templates are no longer part of the product surface. Remove the
-- unused global catalog after the API, page and editor integration are gone.
DROP TABLE IF EXISTS post_templates;
