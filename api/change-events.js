// Append-only write path for the Change Intelligence layer → Neon `change_events`.
//
// The customer-facing capture dialogue (src/components/changeDialogue) POSTs one
// finished change_event here when a field's dialogue completes. This route is a
// thin wrapper: it hands the event to the DAL's writeEvent (the ONLY write path,
// which enforces the closed-vocabulary enums and the append-only / supersede
// rules) against real Neon. No business logic lives here.
//
// CommonJS (module.exports), not `export default`, mirroring api/track-event.js
// and api/save-dossier.js. NOTE: src/setupProxy.js is on the project DO-NOT-TOUCH
// list and mounts routes explicitly, so this endpoint is NOT proxied under local
// `npm start` — it is live on Vercel (filesystem convention). Persistence is
// verified locally by invoking this handler directly (see test-change-events.js).
//
// Always returns 200: capture must never block the customer's onboarding. A
// validation/DB error is reported in the body as { success:false, warning }.

const { neon } = require("@neondatabase/serverless");
const { writeEvent } = require("../src/changeIntelligence/events/writeEvent");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const event = req.body || {};

  if (!process.env.DATABASE_URL) {
    console.warn("[change-events] No DATABASE_URL — event not persisted");
    return res.status(200).json({ success: false, warning: "Database not configured" });
  }

  try {
    // The neon HTTP client exposes `.query(text, params) -> rows[]`, which is
    // exactly the surface writeEvent expects — pass it straight through.
    const sql = neon(process.env.DATABASE_URL);
    const row = await writeEvent(sql, event);
    console.log(`[change-events] ✅ event ${row.id} (${row.field_id} / ${row.workflow})`);
    return res.status(200).json({ success: true, id: row.id });
  } catch (err) {
    // writeEvent throws on enum drift, missing required context, or a bad
    // supersede target. Surface it without failing the user's flow.
    console.error("[change-events] ❌", err.message);
    return res.status(200).json({ success: false, warning: err.message });
  }
};
