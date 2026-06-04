/**
 * /api/nium/constants
 *
 * Live Nium reference-data lookup (street types, business categories, etc.),
 * used to drive Nium-aligned dropdowns in the onboarding flow.
 *
 * This is the FIRST verified-working Nium integration: it hits
 * gateway.nium.com/api/v2/.../onboarding/constants with x-api-key auth and
 * returns live data. (The eKYB company lookups in public-details /
 * exhaustive-details target a separate CaaS host that is still network-blocked.)
 *
 * Method: GET
 * Query params:
 *   - type      (default "CORPORATE")
 *   - region    (required, ISO country code e.g. "GB", "NZ")
 *   - category  (required, e.g. "streetType")
 *
 * Returns: { data: [{ code, description }, ...] }
 */

const { fetchOnboardingConstants, NiumAPIError } = require("../../lib/niumClient");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, region, category } = req.query;

  if (!region || !category) {
    return res.status(400).json({
      error: "Missing required params: region and category",
    });
  }

  try {
    const data = await fetchOnboardingConstants({
      type: type || "CORPORATE",
      region,
      category,
    });
    return res.status(200).json(data);
  } catch (err) {
    if (err instanceof NiumAPIError) {
      console.error("[nium/constants] Nium API error:", err.status, err.body);
      return res.status(err.status >= 500 ? 502 : err.status).json({
        error: "Nium API error",
        detail: err.body,
      });
    }
    console.error("[nium/constants] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
