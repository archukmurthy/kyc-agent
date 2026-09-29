-- 028_dossier_creation_key.sql
-- Part 4: idempotent dossier creation. The analyst's browser mints one key per
-- research run and sends it with the first save; a retried create (the first
-- response was lost) finds the same key and gets the existing dossier back
-- instead of inserting a duplicate. Additive and idempotent.
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS creation_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS entity_dossiers_tenant_creation_key_uidx
  ON entity_dossiers (tenant_id, creation_key)
  WHERE creation_key IS NOT NULL;
