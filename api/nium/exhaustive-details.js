/**
 * /api/nium/exhaustive-details
 *
 * Route 2 of the KYC-Lookup-Wizard.
 * Called by the KYC agent after the applicant selects a company from Route 1 results.
 *
 * Method: POST
 * Body:
 *   - publicDetailsId (required) — from Route 1 result
 *
 * Returns:
 *   - searchId         Must be passed by KYC agent into Create Customer v5
 *   - directors[]      Pre-fill data for the onboarding form
 *   - shareholders[]   Pre-fill data for the onboarding form
 *   - cached: true/false  Whether result came from cache
 *
 * CHARGEABLE API — the cache prevents duplicate charges.
 *   Cache key: exhaustive:{publicDetailsId}
 *   TTL: 90 days
 *
 * Caching uses lib/storage.js (the repo's KV-with-filesystem-fallback layer),
 * so the cache also works under local `npm start` without a provisioned KV.
 */

const { fetchExhaustiveDetails, NiumAPIError } = require("../../lib/niumClient");
const storage = require("../../lib/storage");

const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { publicDetailsId } = req.body || {};

  // --- Input validation ---
  if (!publicDetailsId) {
    return res.status(400).json({
      error: "Missing required body param: publicDetailsId",
    });
  }

  const cacheKey = `exhaustive:${publicDetailsId}`;

  // --- Cache check (protects against duplicate charges) ---
  try {
    const cached = await storage.get(cacheKey);
    if (cached) {
      console.log("[exhaustive-details] Cache hit:", cacheKey);
      return res.status(200).json({ ...cached, cached: true });
    }
  } catch (cacheErr) {
    // Cache read failure is non-fatal — fall through to live API
    console.warn("[exhaustive-details] cache read failed, proceeding to API:", cacheErr.message);
  }

  // --- Live API call ---
  try {
    const data = await fetchExhaustiveDetails(publicDetailsId);

    const payload = {
      searchId: data.searchId,
      directors: data.directors || [],
      shareholders: data.shareholders || [],
      ownershipStructure: data.ownershipStructure || null,
      // Pass through full raw data so KYC agent can extract anything else it needs
      raw: data,
      cached: false,
    };

    // --- Write to cache ---
    try {
      await storage.set(cacheKey, payload, { ttlSeconds: CACHE_TTL_SECONDS });
      console.log("[exhaustive-details] Cached:", cacheKey);
    } catch (cacheErr) {
      // Cache write failure is non-fatal — still return the data
      console.warn("[exhaustive-details] cache write failed:", cacheErr.message);
    }

    return res.status(200).json(payload);
  } catch (err) {
    if (err instanceof NiumAPIError) {
      console.error("[exhaustive-details] Nium API error:", err.status, err.body);
      return res.status(err.status >= 500 ? 502 : err.status).json({
        error: "Nium API error",
        detail: err.body,
      });
    }

    console.error("[exhaustive-details] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
