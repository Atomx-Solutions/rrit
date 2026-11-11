-- The Business Brain tables are no longer read or written: a business's facts,
-- offers, products, tone, audience and rules all live in the workspace profile
-- (businesses.state->'brand'), where earlier migrations copied what these held.
-- Their row-level policies go with them.
DROP TABLE IF EXISTS brand_facts;
DROP TABLE IF EXISTS brand_offers;
DROP TABLE IF EXISTS brand_audiences;
DROP TABLE IF EXISTS brand_voice_versions;
DROP TABLE IF EXISTS brand_guardrails;
