ALTER TABLE assets ADD COLUMN width integer, ADD COLUMN height integer;
ALTER TABLE assets ADD CONSTRAINT asset_dimensions CHECK ((width IS NULL AND height IS NULL) OR (width > 0 AND height > 0));
-- Earlier editorial examples are no longer offered as business content.
UPDATE post_templates SET active=false;
INSERT INTO post_templates (id,payload,sort_order,active) VALUES
('introduce-product','{"id":"introduce-product","title":"Prezanto një produkt","topic":"Produkti","channel":"Instagram","format":"static","image":"","caption":"[Produkti]: [përshkrimi].\n\nNa shkruaj për më shumë informacion.","description":"Përshkruaj çfarë ofron dhe çfarë duhet të dijë klienti."}',1,true),
('business-update','{"id":"business-update","title":"Një lajm nga biznesi","topic":"Komuniteti","channel":"Facebook","format":"static","image":"","caption":"Një lajm nga [biznesi]: [përshkrimi].","description":"Ndaj një përditësim të vërtetë me klientët."}',2,true);
CREATE TABLE worker_heartbeats (name text PRIMARY KEY, last_seen_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX meta_connections_facebook_user ON meta_connections(facebook_user_id);
CREATE INDEX meta_oauth_expiry ON meta_oauth_states(expires_at);
ALTER TABLE publication_jobs ADD COLUMN target_page_id text, ADD COLUMN target_instagram_id text;
UPDATE post_templates SET payload=payload || jsonb_build_object('name',payload->>'title','goal','Prezanto biznesin','industry','Të gjitha') WHERE id IN ('introduce-product','business-update');
