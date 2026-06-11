/**
 * /api/kyc-lookup
 *
 * Serverless entry point for the KYC Lookup Agent. The browser POSTs a company
 * identity; the agent runs the two sequential Nium calls (publicDetails →
 * exhaustiveDetailsSearch) and returns field data in the same shape as AI
 * research results.
 *
 * Method: POST
 * Body:   { companyName, countryCode, registrationNumber? }
 * Returns: { success, fields[], stakeholders{}, publicDetailsId, error,
 *            durationMs, searchedAt, raw }
 *
 * Registered in src/setupProxy.js (same pattern as the other API routes) so it
 * also works under local `npm start`.
 */

const { kycLookupAgent } = require("../agents/kycLookupAgent");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { companyName, countryCode, registrationNumber } = req.body || {};

  if (!companyName || !countryCode) {
    return res.status(400).json({ error: "companyName and countryCode required" });
  }

  try {
    const result = await kycLookupAgent({
      companyName,
      countryCode,
      registrationNumber: registrationNumber || null,
    });

    return res.status(200).json({
      success: !result.error,
      fields: result.fields,
      stakeholders: result.stakeholders,
      publicDetailsId: result.publicDetailsId,
      error: result.error || null,
      durationMs: result.durationMs,
      searchedAt: result.searchedAt,
      raw: result.raw,
    });
  } catch (err) {
    console.error("[api/kyc-lookup] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
