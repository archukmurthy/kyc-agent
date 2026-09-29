-- The tenants table. Every tenant-scoped table references tenants(id), but no
-- migration ever created it: existing databases got it by hand (readiness plan
-- 3.3/3.4). A fresh database - the dedicated UBO database first - could not
-- apply 003, 005, 010 or anything after without it.
--
-- Shape copied column for column from the live KYC dev database. IF NOT EXISTS
-- makes this a no-op wherever the table already exists; it never alters one.

CREATE TABLE IF NOT EXISTS tenants (
  id         VARCHAR(64)  PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(64)  NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
