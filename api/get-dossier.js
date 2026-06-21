// Fetch a saved entity dossier by id so the Preview button and the customer
// invite link (`?dossierId=<id>&journey=customer`) can reconstruct full
// onboarding state from the DB — the dossier is the source of truth. Returns
// raw_research (the complete research.found with .stakeholders + verificationStatus
// intact) plus the tiered arrays and broken-out coverage counts. Read-only;
// best-effort: returns 200 with success:false on any failure so the flow never
// hard-blocks. There is no single `coverage` column — it's reconstructed
// client-side from total_fields/verified_fields/fill_rate/etc.
//
// CommonJS (module.exports) so src/setupProxy.js can require() it for local dev,
// mirroring api/submit.js, api/save-dossier.js, etc.
const { neon } = require("@neondatabase/serverless");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id, tenant } = req.query;

  if (!id) {
    return res.status(400).json({ error: "dossierId required" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({ success: false, error: "Database not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Column names match api/save-dossier.js (entity_dossiers): the dossier is
    // stored with status 'ready' and a saved_at timestamp (exposed as
    // generated_at for the client).
    const rows = await sql`
      SELECT
        id,
        company_name,
        country_code,
        country_name,
        entity_type,
        ownership_type,
        verified_data,
        probable_data,
        indicative_data,
        stakeholders,
        required_documents,
        included_fields,
        excluded_fields,
        custom_questions,
        raw_research,
        total_fields,
        verified_fields,
        probable_fields,
        indicative_fields,
        missing_fields,
        fill_rate,
        verified_fill_rate,
        status,
        saved_at AS generated_at
      FROM entity_dossiers
      WHERE id = ${id}
      AND tenant_id = ${tenant || "nium"}
      AND status != 'deleted'
      LIMIT 1
    `;

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Dossier not found" });
    }

    return res.status(200).json({ success: true, dossier: rows[0] });
  } catch (err) {
    console.error("[get-dossier] Error:", err);
    return res.status(200).json({ success: false, error: err.message });
  }
};
