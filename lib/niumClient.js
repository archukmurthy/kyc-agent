/**
 * niumClient.js
 * Shared HTTP client for all Nium V5 API calls.
 * Centralises base URL, auth header, and error handling
 * so individual routes stay clean.
 *
 * CommonJS (module.exports) so api/nium/* routes and src/setupProxy.js can
 * require() it under local `npm start`. Logic is identical to the original.
 */

const BASE_URL = process.env.NIUM_BASE_URL || "https://gateway-sit.nium.com";
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
 * GET /api/v5/client/{clientHashId}/corporate/publicDetails
 * Searches public registries and returns matching company records.
 *
 * @param {string} businessRegistrationNumber
 * @param {string} countryCode - ISO 3166-1 alpha-2 (e.g. "GB", "SG")
 * @returns {Promise<object>} Raw Nium response
 */
async function fetchPublicDetails(businessRegistrationNumber, countryCode) {
  validateConfig();

  const url = new URL(
    `${BASE_URL}/api/v5/client/${CLIENT_HASH_ID}/corporate/publicDetails`
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

  const url = `${BASE_URL}/api/v5/client/${CLIENT_HASH_ID}/corporate/exhaustiveDetails`;

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
  fetchPublicDetails,
  fetchExhaustiveDetails,
  NiumAPIError,
};
