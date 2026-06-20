/**
 * niumClient.js
 * Shared HTTP client for all Nium V5 API calls.
 * Centralises base URL, auth header, and error handling
 * so individual routes stay clean.
 *
 * CommonJS (module.exports) so api/nium/* routes and src/setupProxy.js can
 * require() it under local `npm start`. Logic is identical to the original.
 */

const { randomUUID } = require("crypto");

// Two Nium products, both now reachable with x-api-key auth:
// - GATEWAY (gateway.nium.com): the main onboarding API. The v2 onboarding
//   constants endpoint is verified working.
// - eKYB (api.preprod.nium.com): the company-lookup product backing
//   publicDetails / exhaustiveDetailsSearch. Verified working end-to-end against
//   the preprod host on 2026-06-09 (the old caas.*.nium.com host that refused
//   the TLS handshake is abandoned).
// The old default `gateway-sit.nium.com` is dead (does not resolve in DNS).
const BASE_URL = process.env.NIUM_BASE_URL || "https://gateway.nium.com";

// eKYB lives on its own host and may use its own key/hash (the preprod sandbox
// uses placeholder hash 1234AB + a product-specific key), so it gets dedicated
// env vars that fall back to the shared gateway creds. NIUM_CAAS_BASE_URL is
// kept as a legacy alias for the base URL.
// Prod eKYB host is https://api.spend.nium.com — switch NIUM_EKYB_BASE_URL to it
// once the prod API key + real client hash are issued (none yet, so we stay on
// the verified preprod host for now).
const EKYB_BASE_URL =
  process.env.NIUM_EKYB_BASE_URL ||
  process.env.NIUM_CAAS_BASE_URL ||
  "https://api.preprod.nium.com";

const CLIENT_HASH_ID = process.env.NIUM_CLIENT_HASH_ID;
const API_KEY = process.env.NIUM_API_KEY;
const EKYB_CLIENT_HASH_ID = process.env.NIUM_EKYB_CLIENT_HASH_ID || CLIENT_HASH_ID;
const EKYB_API_KEY = process.env.NIUM_EKYB_API_KEY || API_KEY;

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
 * Returns the base headers required for every Nium API call. A fresh
 * X_REQUEST_ID is generated per call for request tracing (matches Nium's
 * documented examples). Pass a product-specific key (e.g. EKYB_API_KEY) when
 * the call targets a host that uses different credentials.
 */
function getHeaders(apiKey = API_KEY) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": apiKey,
    X_REQUEST_ID: randomUUID(),
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
 * GET {EKYB}/api/v5/client/{clientHashId}/corporate/publicDetails
 * Searches public registries and returns matching company records.
 * VERIFIED working against the preprod host on 2026-06-09.
 *
 * @param {object} params
 * @param {string} params.type                       entity type (e.g. "PUBLIC_COMPANY")
 * @param {string} params.businessRegistrationNumber registry number to search
 * @param {string} params.registeredCountry          ISO 3166-1 alpha-2 (e.g. "GB", "SG")
 * @param {string} params.region                     searching region (ISO alpha-2)
 * @returns {Promise<object>} Raw Nium response ({ matchResponses: [{ publicDetailsId, businessName, businessRegistrationNumber }] })
 */
async function fetchPublicDetails({
  type,
  businessRegistrationNumber,
  registeredCountry,
  region,
}) {
  validateConfig();

  const url = new URL(
    `${EKYB_BASE_URL}/api/v5/client/${EKYB_CLIENT_HASH_ID}/corporate/publicDetails`
  );
  if (type) url.searchParams.set("type", type);
  url.searchParams.set("businessRegistrationNumber", businessRegistrationNumber);
  if (registeredCountry) url.searchParams.set("registeredCountry", registeredCountry);
  if (region) url.searchParams.set("region", region);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getHeaders(EKYB_API_KEY),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new NiumAPIError(response.status, error, "publicDetails");
  }

  return response.json();
}

/**
 * GET {EKYB}/api/v5/client/{clientHashId}/corporate/exhaustiveDetailsSearch?publicDetailsId=...
 * Returns the full company record: stakeholders (individual + corporate),
 * registered address, and a searchId that feeds Create-Customer v5.
 * VERIFIED working against the preprod host on 2026-06-09.
 * CHARGEABLE — the route layer handles caching to ensure single calls.
 *
 * @param {string} publicDetailsId - From a fetchPublicDetails matchResponses entry
 * @returns {Promise<object>} Raw Nium response
 */
async function fetchExhaustiveDetails(publicDetailsId) {
  validateConfig();

  const url = new URL(
    `${EKYB_BASE_URL}/api/v5/client/${EKYB_CLIENT_HASH_ID}/corporate/exhaustiveDetailsSearch`
  );
  url.searchParams.set("publicDetailsId", publicDetailsId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: getHeaders(EKYB_API_KEY),
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
