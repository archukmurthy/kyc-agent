/**
 * niumClient.js
 * Shared HTTP client for all Nium V5 API calls.
 * Centralises base URL, auth header, and error handling
 * so individual routes stay clean.
 *
 * CommonJS (module.exports) so api/nium/* routes and src/setupProxy.js can
 * require() it under local `npm start`. Logic is identical to the original.
 */

// Two distinct Nium products on two distinct hosts:
// - GATEWAY (gateway.nium.com): the main onboarding API. The v2 onboarding
//   constants endpoint is verified working with x-api-key auth.
// - CaaS (caas.*.nium.com): the eKYB Compliance-as-a-Service product that backs
//   publicDetails / exhaustiveDetails. As of 2026-06 its preprod host still
//   refuses the TLS handshake (allowlist/VPN gate) and there is no resolvable
//   prod host — so those two lookups remain blocked at the network layer.
// The old default `gateway-sit.nium.com` is dead (does not resolve in DNS).
const BASE_URL = process.env.NIUM_BASE_URL || "https://gateway.nium.com";
const CAAS_BASE_URL = process.env.NIUM_CAAS_BASE_URL || "https://caas.preprod.nium.com/onboarding";
const CLIENT_HASH_ID = process.env.NIUM_CLIENT_HASH_ID;
const API_KEY = process.env.NIUM_API_KEY;

/**
 * Custom error class so routes can distinguish Nium API errors
 * from unexpected runtime errors.
 */
class NiumAPIError extends Error {
  constructor(status, body, endpoint) {
    super(`Nium API error on ${endpoint}: ${status}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

/**
 * Validates that required env variables are present.
 * Call at the top of each API route.
 */
function validateConfig() {
  if (!CLIENT_HASH_ID) throw new Error("Missing env: NIUM_CLIENT_HASH_ID");
  if (!API_KEY) throw new Error("Missing env: NIUM_API_KEY");
}

/**
 * Returns the base headers required for every Nium API call.
 */
function getHeaders() {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": API_KEY,
  };
}

/**
 * GET /api/v2/client/{clientHashId}/onboarding/constants
 * Reference-data lookup (street types, business categories, etc.) used to drive
 * Nium-aligned dropdowns. VERIFIED WORKING against gateway.nium.com with
 * x-api-key auth — this is the live, deterministic Nium call the app can rely on
 * today (the eKYB company lookups below are still host-blocked).
 *
 * @param {object} params
 * @param {string} params.type      e.g. "CORPORATE"
 * @param {string} params.region    ISO country (e.g. "NZ", "GB")
 * @param {string} params.category  constant set to fetch (e.g. "streetType")
 * @returns {Promise<object>} Raw Nium response ({ data: [{ code, description }] })
 */
async function fetchOnboardingConstants({ type, region, category }) {
  validateConfig();

  const url = new URL(
    `${BASE_URL}/api/v2/client/${CLIENT_HASH_ID}/onboarding/constants`
  );
  if (type) url.searchParams.set("type", type);
  if (region) url.searchParams.set("region", region);
  if (category) url.searchParams.set("category", category);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new NiumAPIError(response.status, error, "constants");
  }

  return response.json();
}

/**
 * GET {CAAS}/api/v5/client/{clientHashId}/corporate/publicDetails
 * Searches public registries and returns matching company records.
 *
 * NOTE: eKYB lives on the CaaS host (CAAS_BASE_URL), NOT the gateway. That host
 * is still network-blocked (see top-of-file note), so this call cannot complete
 * yet. Path/param shape is the best-known documented form and is UNVERIFIED
 * against a live response — revisit once CaaS connectivity is granted.
 *
 * @param {string} businessRegistrationNumber
 * @param {string} countryCode - ISO 3166-1 alpha-2 (e.g. "GB", "SG")
 * @returns {Promise<object>} Raw Nium response
 */
async function fetchPublicDetails(businessRegistrationNumber, countryCode) {
  validateConfig();

  const url = new URL(
    `${CAAS_BASE_URL}/api/v5/client/${CLIENT_HASH_ID}/corporate/publicDetails`
  );
  url.searchParams.set("businessRegistrationNumber", businessRegistrationNumber);
  url.searchParams.set("countryCode", countryCode);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new NiumAPIError(response.status, error, "publicDetails");
  }

  return response.json();
}

/**
 * POST /api/v5/client/{clientHashId}/corporate/exhaustiveDetails
 * Returns full company record: directors, shareholders, ownership structure.
 * CHARGEABLE — the route layer handles caching to ensure single calls.
 *
 * @param {string} publicDetailsId - Returned by fetchPublicDetails
 * @returns {Promise<object>} Raw Nium response
 */
async function fetchExhaustiveDetails(publicDetailsId) {
  validateConfig();

  // eKYB CaaS host (see fetchPublicDetails note) — still network-blocked.
  const url = `${CAAS_BASE_URL}/api/v5/client/${CLIENT_HASH_ID}/corporate/exhaustiveDetails`;

  const response = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ publicDetailsId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new NiumAPIError(response.status, error, "exhaustiveDetails");
  }

  return response.json();
}

module.exports = {
  validateConfig,
  fetchOnboardingConstants,
  fetchPublicDetails,
  fetchExhaustiveDetails,
  NiumAPIError,
};
