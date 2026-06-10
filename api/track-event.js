// Lightweight event tracking → Neon `session_timeline`.
//
// Fire-and-forget from the client (see App.js#trackEvent). ALWAYS returns 200 —
// event tracking must never block or fail the user's interaction.
//
// CommonJS (module.exports), not `export default`, so src/setupProxy.js can
// require() it for local `npm start` (mirrors api/submit.js, api/doc-search.js,
// etc.). Vercel supports both forms in production.
//
// Schema note: writes session_id (NULLABLE — landing-page events have no session
// yet), event_type, event_data (JSONB), tenant_id, occurred_at. The event_data
// + tenant_id columns and the nullable session_id come from migration
// db/migrations/004_session_timeline_update.sql.

const { neon } = require("@neondatabase/serverless");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { tenantId, eventType, eventData, sessionId, timestamp } = req.body || {};

  if (!eventType) {
    return res.status(400).json({ error: "eventType is required" });
  }

  // Always return 200 — event tracking must never block the user.
  try {
    if (!process.env.DATABASE_URL) {
      console.log("[track-event] No DB — logging only:", eventType, eventData);
      return res.status(200).json({ success: true });
    }

    const sql = neon(process.env.DATABASE_URL);

    await sql`
      INSERT INTO session_timeline (
        session_id,
        event_type,
        event_data,
        tenant_id,
        occurred_at
      )
      VALUES (
        ${sessionId || null},
        ${eventType},
        ${JSON.stringify(eventData || {})},
        ${tenantId || null},
        ${timestamp ? new Date(timestamp) : new Date()}
      )
    `;

    console.log(`[track-event] ✅ ${eventType}`, eventData);

    return res.status(200).json({ success: true });
  } catch (err) {
    // Log but never fail.
    console.error("[track-event] ❌", err.message);
    return res.status(200).json({ success: true, warning: err.message });
  }
};
