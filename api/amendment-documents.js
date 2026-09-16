// Read route for the Fill Gaps "Amendment Documentation" section → Neon `change_events`.
//
// Given a submission identifier, it loads that submission's change_events via the
// DAL, runs the pure deriveAmendmentDocuments derivation, and returns the list of
// documents the customer currently owes because of their changes. All logic is in
// the pure module; this route is a thin wrapper (load → derive → respond).
//
// A submissionId that matches a DOSSIER (entity_dossiers row) requires a
// read-capable credential (lib/dossierAccess.js) — an analyst scoped to that
// tenant, or the dossier's own customer token. A submissionId that matches no
// dossier is a fresh application and is read exactly as before, with no
// credential required (backlog PLAT-7).
//
// Data flows ONE way: the dialogue writes events (api/change-events.js) → this
// route derives the doc list → the Fill Gaps component renders it. This route
// never writes and never reaches into the dialogue or the engine.
//
// CommonJS (module.exports), mirroring api/get-dossier.js. GET; the submission id
// arrives as req.query.submissionId. src/setupProxy.js mounts this route
// explicitly so it also works under local `npm start`.

const { neon } = require("@neondatabase/serverless");
const { getEventsBySubmission } = require("../src/changeIntelligence/events/readEvents");
const { deriveAmendmentDocuments } = require("../src/changeIntelligence/amendmentDocuments");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, getEventsBySubmission, deriveAmendmentDocuments, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const submissionId = req.query && req.query.submissionId;
  if (!submissionId) {
    return res.status(400).json({ error: "submissionId is required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[amendment-documents] No DATABASE_URL — returning empty list");
    return res.status(200).json({ documents: [] });
  }

  // Is this a DOSSIER's documents? This lookup is a security boundary: if it
  // cannot run (a bad connection, a schema mismatch, …) we fail CLOSED with a
  // controlled 5xx rather than risk treating a dossier-keyed read as an
  // unauthenticated "fresh application" read.
  let sql;
  let dossier = null;
  try {
    sql = _deps.neon(process.env.DATABASE_URL);
    // No status filter here: a soft-deleted dossier's id must still be
    // recognised as a dossier (and gated behind a credential), never fall
    // through to the unauthenticated "fresh application" branch below.
    const found = await sql`
      SELECT id, tenant_id, owned_by
      FROM entity_dossiers
      WHERE id::text = ${String(submissionId)}
      LIMIT 1
    `;
    dossier = found.length ? found[0] : null;
  } catch (err) {
    console.error("[amendment-documents] dossier lookup failed", err);
    return res.status(500).json({ error: "lookup_failed" });
  }

  if (dossier) {
    const actor = await _deps.access.resolveDossierActor(req);
    const permitted = _deps.access.canReadDossier(actor, dossier);
    if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });
  }
  // A fresh application (no dossier) is unchanged — backlog PLAT-7.

  try {
    const events = await _deps.getEventsBySubmission(sql, submissionId);
    const documents = _deps.deriveAmendmentDocuments(events);
    return res.status(200).json({ documents });
  } catch (err) {
    // A read failure must not break the Fill Gaps page — return an empty list
    // and log. The customer still sees the standard Required Documents step.
    console.error("[amendment-documents] ❌", err.message);
    return res.status(200).json({ documents: [], warning: "amendment_documents_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
