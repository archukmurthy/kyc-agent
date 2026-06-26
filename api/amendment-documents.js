// Read route for the Fill Gaps "Amendment Documentation" section → Neon `change_events`.
//
// Given a submission identifier, it loads that submission's change_events via the
// DAL, runs the pure deriveAmendmentDocuments derivation, and returns the list of
// documents the customer currently owes because of their changes. All logic is in
// the pure module; this route is a thin wrapper (load → derive → respond).
//
// Data flows ONE way: the dialogue writes events (api/change-events.js) → this
// route derives the doc list → the Fill Gaps component renders it. This route
// never writes and never reaches into the dialogue or the engine.
//
// CommonJS (module.exports), mirroring api/get-dossier.js. GET; the submission id
// arrives as req.query.submissionId. NOTE: src/setupProxy.js (DO-NOT-TOUCH) mounts
// routes explicitly, so this endpoint is live on Vercel but NOT under local
// `npm start`; verified locally via direct handler invocation.

const { neon } = require("@neondatabase/serverless");
const { getEventsBySubmission } = require("../src/changeIntelligence/events/readEvents");
const { deriveAmendmentDocuments } = require("../src/changeIntelligence/amendmentDocuments");

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

  try {
    const sql = neon(process.env.DATABASE_URL);
    const events = await getEventsBySubmission(sql, submissionId);
    const documents = deriveAmendmentDocuments(events);
    return res.status(200).json({ documents });
  } catch (err) {
    // A read failure must not break the Fill Gaps page — return an empty list
    // and log. The customer still sees the standard Required Documents step.
    console.error("[amendment-documents] ❌", err.message);
    return res.status(200).json({ documents: [], warning: err.message });
  }
};
