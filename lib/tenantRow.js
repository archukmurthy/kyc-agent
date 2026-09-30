"use strict";

// Every tenant-scoped table references tenants(id), and nothing else creates
// the row for a UBO trial workspace (trial-acme-1a2b3c4d): trials live in KV,
// so the first case save or chart upload of every trial tester failed on the
// foreign key. The UBO routes call this before they write.
//
// Idempotent and cheap. The id comes from the verified caller, never from a
// request (see api/save-dossier.js for the history of that hole). Any conflict
// - id or slug - is left alone; a genuinely missing row then fails loudly at
// the foreign key rather than being papered over here.
//
// (api/save-dossier.js and api/lib/finalizeSubmission.js hold the same upsert
// inline; moving them here is TENANT-ROW-1.)

async function ensureTenantRow(db, tenantId) {
  if (!tenantId) throw new Error("ensureTenantRow needs a tenant");
  await db.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT DO NOTHING", [tenantId]);
}

module.exports = { ensureTenantRow };
