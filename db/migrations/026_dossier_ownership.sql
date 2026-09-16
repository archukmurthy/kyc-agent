-- 026_dossier_ownership.sql
-- Who controls a dossier. 'analyst' until the customer first changes anything
-- (a dossier save or a change record), then 'customer' — after which the
-- analyst may still read the dossier but can no longer write to it.
-- Additive and idempotent: existing rows default to 'analyst'.
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS owned_by TEXT NOT NULL DEFAULT 'analyst';

-- When the customer last wrote to this dossier (audit + support visibility).
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS last_customer_action_at TIMESTAMPTZ;
