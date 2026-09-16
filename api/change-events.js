// Append-only write path for the Change Intelligence layer → Neon `change_events`.
//
// The customer-facing capture dialogue (src/components/changeDialogue) POSTs one
// finished change_event here when a field's dialogue completes. This route is a
// thin wrapper: it hands the event to the DAL's writeEvent (the ONLY write path,
// which enforces the closed-vocabulary enums and the append-only / supersede
// rules) against real Neon. No business logic lives here.
//
// A record keyed to a DOSSIER (submissionId matches an entity_dossiers row)
// requires a write-capable credential (lib/dossierAccess.js) — an analyst
// scoped to that tenant, or the dossier's own customer token — and a customer
// record flips the dossier's `owned_by` to 'customer' (analyst becomes
// read-only from then on). A submissionId that matches no dossier is a fresh
// application and is written exactly as before, with no credential required
// (backlog PLAT-7).
//
// CommonJS (module.exports), not `export default`, mirroring api/track-event.js
// and api/save-dossier.js. src/setupProxy.js mounts this route explicitly so it
// also works under local `npm start`.
//
// Always returns 200 for a fresh application: capture must never block the
// customer's onboarding. A validation/DB error on the write itself is reported
// in the body as { success:false, warning }. A dossier-keyed request that fails
// its credential/permission check gets a proper 4xx instead.

const { neon } = require("@neondatabase/serverless");
const { writeEvent } = require("../src/changeIntelligence/events/writeEvent");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, writeEvent, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const event = req.body || {};

  if (!process.env.DATABASE_URL) {
    console.warn("[change-events] No DATABASE_URL — event not persisted");
    return res.status(200).json({ success: false, warning: "Database not configured" });
  }

  // Is this record about a DOSSIER? `id::text` so a non-UUID submission id (a
  // fresh application) is simply "no match" rather than a cast error. This
  // lookup is a security boundary: if it cannot run (a bad connection, a
  // schema mismatch, …) we fail CLOSED with a controlled 5xx rather than risk
  // treating a dossier-keyed write as an unauthenticated "fresh application"
  // and writing it unchecked.
  let sql;
  let dossier = null;
  try {
    sql = _deps.neon(process.env.DATABASE_URL);
    if (event.submissionId) {
      // No status filter here: a soft-deleted dossier's id must still be
      // recognised as a dossier (and gated behind a credential), never fall
      // through to the unauthenticated "fresh application" branch below.
      const found = await sql`
        SELECT id, tenant_id, owned_by
        FROM entity_dossiers
        WHERE id::text = ${String(event.submissionId)}
        LIMIT 1
      `;
      dossier = found.length ? found[0] : null;
    }
  } catch (err) {
    console.error("[change-events] dossier lookup failed", err);
    return res.status(500).json({ error: "lookup_failed" });
  }

  let actor = null;
  if (dossier) {
    actor = await _deps.access.resolveDossierActor(req);
    const permitted = _deps.access.canWriteDossier(actor, dossier);
    if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });
  }
  // A fresh application (no dossier) is unchanged — backlog PLAT-7.

  try {
    if (dossier && actor && actor.kind === "customer") {
      // The customer changed something: from now on the analyst may only read.
      // Lock the dossier BEFORE writing the record so if the lock fails,
      // no change record exists (safe). A record without a lock is not.
      await sql`
        UPDATE entity_dossiers
        SET owned_by = 'customer', last_customer_action_at = NOW()
        WHERE id = ${dossier.id} AND tenant_id = ${dossier.tenant_id}
      `;
    }

    const row = await _deps.writeEvent(sql, event);

    console.log(`[change-events] ✅ event ${row.id} (${row.field_id} / ${row.workflow})`);
    return res.status(200).json({ success: true, id: row.id });
  } catch (err) {
    // writeEvent throws on enum drift, missing required context, or a bad
    // supersede target. Surface it without failing the user's flow.
    console.error("[change-events] ❌", err.message);
    return res.status(200).json({ success: false, warning: "event_write_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
