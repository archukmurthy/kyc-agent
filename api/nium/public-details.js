/**
 * /api/nium/public-details
 *
 * Route 1 of the KYC-Lookup-Wizard.
 * Called by the KYC agent at the start of the eKYB flow.
 *
 * Method: GET
 * Query params:
 *   - businessRegistrationNumber (required)
 *   - countryCode (required, ISO 3166-1 alpha-2)
 *
 * Returns:
 *   - results[]        Array of matching companies (may be empty)
 *   - noResults: true  If no match found — KYC agent should fall back to manual KYB
 *
 * Each result includes publicDetailsId which must be passed to /api/nium/exhaustive-details
 */

const { fetchPublicDetails, NiumAPIError } = require("../../lib/niumClient");

// TODO(step1-mapping): `type` and `region` are hardcoded to the verified
// working preprod test values for now. They must be derived from the Step 1
// company-search logic (entity type + searching region) and passed through —
// at which point these defaults become fallbacks only.
const DEFAULT_TYPE = "PUBLIC_COMPANY";
const DEFAULT_REGION = "GB";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { businessRegistrationNumber, countryCode, type, region } = req.query;

  // --- Input validation ---
  if (!businessRegistrationNumber || !countryCode) {
    return res.status(400).json({
      error: "Missing required params: businessRegistrationNumber and countryCode",
    });
  }

  if (countryCode.length !== 2) {
    return res.status(400).json({
      error: "countryCode must be ISO 3166-1 alpha-2 (e.g. GB, SG, AU)",
    });
  }

  try {
    const data = await fetchPublicDetails({
      type: type || DEFAULT_TYPE,
      businessRegistrationNumber,
      registeredCountry: countryCode,
      region: region || DEFAULT_REGION,
    });

    // Normalise: Nium returns matches under `matchResponses`. Empty → signal
    // the KYC agent to fall back to manual KYB.
    const results = Array.isArray(data)
      ? data
      : data.matchResponses || data.results || [];

    if (results.length === 0) {
      return res.status(200).json({
        noResults: true,
        message: "No registry match found. Proceed with manual KYB.",
        results: [],
      });
    }

    return res.status(200).json({
      noResults: false,
      results,
    });
  } catch (err) {
    if (err instanceof NiumAPIError) {
      console.error("[public-details] Nium API error:", err.status, err.body);
      return res.status(err.status >= 500 ? 502 : err.status).json({
        error: "Nium API error",
        detail: err.body,
      });
    }

    console.error("[public-details] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
