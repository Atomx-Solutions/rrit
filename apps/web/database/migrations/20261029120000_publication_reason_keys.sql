-- Publication reasons were stored as Albanian sentences, so every business
-- read them in Albanian whatever its language. They are now translation keys;
-- the reasons already stored are rewritten to the same keys.
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.confirmed"')
  WHERE payload->>'policyReason' = 'Meta e konfirmoi publikimin.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.uncertain"')
  WHERE payload->>'policyReason' = 'Meta nuk dha konfirmim të plotë. Kontrollo profilin përpara çdo riprovimi; postimi nuk ridërgohet automatikisht.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.fixAuthentication"')
  WHERE payload->>'policyReason' = 'Rilidhe llogarinë Meta; token-i aktual nuk është më i vlefshëm.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.fixPermission"')
  WHERE payload->>'policyReason' = 'Rilidhe llogarinë Meta dhe mirato lejet e kërkuara për publikim.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.fixMedia"')
  WHERE payload->>'policyReason' = 'Kontrollo formatin dhe madhësinë e fotografisë, pastaj valido postimin sërish.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.busy"')
  WHERE payload->>'policyReason' = 'Meta është përkohësisht e zënë; sistemi do të provojë sërish automatikisht.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.retryExhausted"')
  WHERE payload->>'policyReason' = 'Tentimet automatike përfunduan. Kontrollo lidhjen dhe nise publikimin sërish.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.versionChanged"')
  WHERE payload->>'policyReason' = 'Postimi ndryshoi pas planifikimit. Kontrollo dhe mirato versionin aktual.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.checkFailed"')
  WHERE payload->>'policyReason' = 'Kontrollo lidhjen, përmbajtjen dhe fotografinë, pastaj valido postimin sërish.';
UPDATE posts SET payload = jsonb_set(payload, '{policyReason}', '"publication.checkConnection"')
  WHERE payload->>'policyReason' = 'Kontrollo gjendjen e lidhjes dhe postimin përpara një tentimi të ri.';
