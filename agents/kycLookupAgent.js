/**
 * kycLookupAgent.js
 *
 * KYC Lookup Agent — separate agent that calls the Nium KYB (eKYB) API and
 * returns structured field data in the same shape as AI research results.
 *
 * Two sequential API calls:
 *   1. publicDetails           — confirms the company exists, returns a
 *                                publicDetailsId (and basic identity fields)
 *   2. exhaustiveDetailsSearch — full company record incl. stakeholders,
 *                                address, registry info (CHARGEABLE — cached)
 *
 * Interface contract with the main KYC agent:
 *   Input:  { companyName, countryCode, registrationNumber? }
 *   Output: { fields[], stakeholders{}, publicDetailsId, raw, error,
 *             searchedAt, durationMs }
 *
 * Each fields[] item matches the AI-research result shape exactly:
 *   { field, value, source, sourceUrl, sourceTier, verificationStatus,
 *     fetchedAt, [stakeholders], [addressComponents], [addressSufficient] }
 * so the main KYC agent processes Nium results identically to AI research and
 * does not know (or care) that the data came from Nium.
 *
 * TRANSPORT / AUTH: delegated to lib/niumClient.js — the verified, working
 * Nium V5 client (x-api-key + X_REQUEST_ID, eKYB host api.preprod.nium.com,
 * env vars NIUM_EKYB_* falling back to NIUM_CLIENT_HASH_ID / NIUM_API_KEY).
 * This agent does NOT re-implement HTTP or hardcode credentials/base URLs —
 * it reuses the single source of truth so auth stays consistent across the app.
 *
 * Owner: separate from the main KYC agent — can be extended independently.
 */

const {
  fetchPublicDetails,
  fetchExhaustiveDetails,
  NiumAPIError,
} = require("../lib/niumClient");
const storage = require("../lib/storage");

// ── Constants ──────────────────────────────────────────────────────────────

// Source metadata stamped on every Nium-sourced field. Nium registry data is
// authoritative → tier1 / verified.
const NIUM_SOURCE = {
  source: "Nium KYB API",
  sourceUrl: "https://api.nium.com",
  sourceTier: "tier1",
  verificationStatus: "verified",
};

// The eKYB publicDetails endpoint searches registries by registration number.
// `type` defaults to the verified-working preprod value; callers may pass a
// derived entity type once Step-1 search wiring is richer.
const DEFAULT_TYPE = "PUBLIC_COMPANY";

// exhaustiveDetailsSearch is chargeable. Mirror the api/nium/exhaustive-details
// route's cache (same key + TTL) so the agent and the route share one cache and
// never double-charge for the same company.
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// Short opaque id for synthesised stakeholder rows. Deterministic-enough for a
// single response; the UI only needs uniqueness within one lookup.
let _idCounter = 0;
function shortId() {
  _idCounter += 1;
  return `nium${_idCounter.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

// ── Mapping: publicDetails → fields ──────────────────────────────────────────

/**
 * Map a publicDetails response to identity fields + the publicDetailsId needed
 * for the second call. Nium returns matches under `matchResponses` (the route
 * also tolerates `results`); we use the first match.
 *
 * @param {object} data Raw publicDetails response
 * @returns {{ fields: object[], publicDetailsId: string|null }}
 */
function mapPublicDetails(data) {
  const matches = Array.isArray(data)
    ? data
    : data?.matchResponses || data?.results || [];
  const match = matches[0];
  if (!match) return { fields: [], publicDetailsId: null };

  const fields = [];
  const ts = new Date().toISOString();

  if (match.businessName) {
    fields.push({ field: "legal_name", value: match.businessName, ...NIUM_SOURCE, fetchedAt: ts });
  }
  if (match.businessRegistrationNumber) {
    fields.push({ field: "registration_number", value: match.businessRegistrationNumber, ...NIUM_SOURCE, fetchedAt: ts });
  }
  if (match.businessType) {
    fields.push({ field: "business_type", value: match.businessType, ...NIUM_SOURCE, fetchedAt: ts });
  }

  return { fields, publicDetailsId: match.publicDetailsId || null };
}

// ── Mapping: exhaustiveDetails → fields + stakeholders ───────────────────────

/**
 * Map an exhaustiveDetailsSearch response to the full field set + a structured
 * stakeholders object. Stakeholder nationality + date_of_birth are returned by
 * the API and pre-populated as verified tier1 data (the key advantage over AI
 * research, where the customer must supply them).
 *
 * @param {object} data Raw exhaustiveDetailsSearch response
 * @returns {{ fields: object[], stakeholders: object }}
 */
function mapExhaustiveDetails(data) {
  if (!data) return { fields: [], stakeholders: { directors: [], ubos: [], all: [] } };

  const fields = [];
  const ts = new Date().toISOString();

  // ── Company fields ──
  if (data.businessName) {
    fields.push({ field: "legal_name", value: data.businessName, ...NIUM_SOURCE, fetchedAt: ts });
  }
  if (data.businessRegistrationNumber) {
    fields.push({ field: "registration_number", value: data.businessRegistrationNumber, ...NIUM_SOURCE, fetchedAt: ts });
  }
  if (data.website) {
    fields.push({ field: "website", value: data.website, ...NIUM_SOURCE, fetchedAt: ts });
  }
  if (data.registeredCountry) {
    fields.push({ field: "country_of_incorporation", value: data.registeredCountry, ...NIUM_SOURCE, fetchedAt: ts });
  }
  if (data.registeredDate) {
    fields.push({ field: "incorporation_date", value: data.registeredDate, ...NIUM_SOURCE, fetchedAt: ts });
  }

  // ── Registered address ──
  const addr = data.addresses?.registeredAddress;
  if (addr) {
    fields.push({
      field: "registered_address",
      value: [addr.addressLine1, addr.addressLine2, addr.city, addr.state, addr.postcode, addr.country]
        .filter(Boolean)
        .join(", "),
      addressComponents: {
        line1: addr.addressLine1 || "",
        line2: addr.addressLine2 || "",
        city: addr.city || "",
        state: addr.state || "",
        postcode: addr.postcode || "",
        country: addr.country || "",
      },
      addressSufficient: !!(addr.addressLine1 && addr.city),
      ...NIUM_SOURCE,
      fetchedAt: ts,
    });
  }

  // ── Size of business ──
  if (data.sizeOfBusiness && Object.keys(data.sizeOfBusiness).length > 0) {
    fields.push({
      field: "employee_count_band",
      value: data.sizeOfBusiness.employeeCount || JSON.stringify(data.sizeOfBusiness),
      ...NIUM_SOURCE,
      fetchedAt: ts,
    });
  }

  // ── Stakeholders — individuals ──
  const individuals = (data.stakeholders?.individual || []).map((p) => {
    const fullName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
    const roles = (p.positions || []).map((pos) => pos.title);
    const isUBO = roles.includes("UBO");
    return {
      id: shortId(),
      type: isUBO ? "ubo" : "director",
      full_name: fullName,
      role: roles.filter((r) => r !== "UBO").join(", ") || roles[0] || "",
      share_percentage: p.sharePercentage || null,
      // PRE-POPULATED FROM API — customer does not need to fill these.
      nationality: p.nationality || "",
      date_of_birth: p.dateOfBirth || "",
      residential_country: p.address?.country || "",
      phone: p.mobile || "",
      source: "Nium KYB API",
      sourceUrl: "https://api.nium.com",
      sourceTier: "tier1",
      fetchedAt: ts,
      customer_confirmed: false,
      customer_added: false,
    };
  });

  // ── Stakeholders — corporates (treated as UBOs) ──
  const corporates = (data.stakeholders?.corporate || []).map((c) => ({
    id: shortId(),
    type: "ubo",
    full_name: c.businessName || "",
    role: (c.positions || []).map((p) => p.title).join(", "),
    share_percentage: c.sharePercentage || null,
    registration_number: c.businessRegistrationNumber || "",
    country: c.registeredCountry || "",
    source: "Nium KYB API",
    sourceUrl: "https://api.nium.com",
    sourceTier: "tier1",
    fetchedAt: ts,
    customer_confirmed: false,
    customer_added: false,
  }));

  const directors = individuals.filter(
    (p) => p.type === "director" || (p.role || "").toLowerCase().includes("director")
  );
  const ubos = [...individuals.filter((p) => p.type === "ubo"), ...corporates];

  if (directors.length > 0) {
    fields.push({
      field: "directors",
      value: directors.map((d) => d.full_name).join(", "),
      stakeholders: directors,
      ...NIUM_SOURCE,
      fetchedAt: ts,
    });
  }
  if (ubos.length > 0) {
    fields.push({
      field: "ubo_names",
      value: ubos.map((u) => u.full_name + (u.share_percentage ? ` (${u.share_percentage}%)` : "")).join(", "),
      stakeholders: ubos,
      ...NIUM_SOURCE,
      fetchedAt: ts,
    });
  }

  return { fields, stakeholders: { directors, ubos, all: [...directors, ...ubos] } };
}

// ── Cached exhaustive call ───────────────────────────────────────────────────

// exhaustiveDetailsSearch is chargeable; share the route's cache (key +
// TTL) so repeat lookups for the same publicDetailsId are free. Cache failures
// are non-fatal — fall through to the live API.
async function fetchExhaustiveDetailsCached(publicDetailsId) {
  const cacheKey = `exhaustive:${publicDetailsId}`;
  try {
    const cached = await storage.get(cacheKey);
    if (cached) {
      console.log("[KYCLookupAgent] exhaustive cache hit:", cacheKey);
      return cached;
    }
  } catch (e) {
    console.warn("[KYCLookupAgent] cache read failed:", e.message);
  }

  const data = await fetchExhaustiveDetails(publicDetailsId);

  try {
    await storage.set(cacheKey, data, { ttlSeconds: CACHE_TTL_SECONDS });
  } catch (e) {
    console.warn("[KYCLookupAgent] cache write failed:", e.message);
  }
  return data;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Main entry point for the KYC Lookup Agent.
 *
 * @param {object} params
 * @param {string} params.companyName
 * @param {string} params.countryCode             ISO 3166-1 alpha-2
 * @param {string} [params.registrationNumber]    business registration number
 * @param {string} [params.type]                  entity type for the registry search
 * @returns {Promise<object>} { companyName, countryCode, fields, stakeholders,
 *   publicDetailsId, raw, error, searchedAt, durationMs }
 */
async function kycLookupAgent(params) {
  const { companyName, countryCode, registrationNumber, type } = params || {};

  console.log(`[KYCLookupAgent] Starting lookup: ${companyName} (${countryCode})`);

  const startTime = Date.now();
  const result = {
    companyName,
    countryCode,
    fields: [],
    stakeholders: { directors: [], ubos: [], all: [] },
    publicDetailsId: null,
    raw: {},
    error: null,
    searchedAt: new Date().toISOString(),
    durationMs: 0,
  };

  try {
    // ── Step 1: publicDetails ──
    // The eKYB registry search keys on registration number. Without one the
    // registry cannot match — surface a clear, actionable error rather than a
    // confusing empty result.
    if (!registrationNumber) {
      result.error =
        "Nium registry lookup requires a business registration number. " +
        "Provide registrationNumber or use AI research instead.";
      result.durationMs = Date.now() - startTime;
      return result;
    }

    console.log("[KYCLookupAgent] Step 1: publicDetails");
    const publicData = await fetchPublicDetails({
      type: type || DEFAULT_TYPE,
      businessRegistrationNumber: registrationNumber,
      registeredCountry: countryCode,
      region: countryCode,
    });
    result.raw.publicDetails = publicData;

    const publicMapped = mapPublicDetails(publicData);
    result.fields.push(...publicMapped.fields);
    result.publicDetailsId = publicMapped.publicDetailsId;

    if (!result.publicDetailsId) {
      result.error = "Company not found in Nium registry";
      result.durationMs = Date.now() - startTime;
      return result;
    }
    console.log(`[KYCLookupAgent] Found: ${result.publicDetailsId}`);

    // ── Step 2: exhaustiveDetailsSearch (cached) ──
    console.log("[KYCLookupAgent] Step 2: exhaustiveDetailsSearch");
    const exhaustiveData = await fetchExhaustiveDetailsCached(result.publicDetailsId);
    result.raw.exhaustiveDetails = exhaustiveData;

    const exhaustiveMapped = mapExhaustiveDetails(exhaustiveData);

    // Merge fields — exhaustive wins on duplicates (richer data).
    const fieldMap = new Map(result.fields.map((f) => [f.field, f]));
    exhaustiveMapped.fields.forEach((f) => fieldMap.set(f.field, f));
    result.fields = Array.from(fieldMap.values());

    result.stakeholders = exhaustiveMapped.stakeholders;

    console.log(
      `[KYCLookupAgent] Complete. ${result.fields.length} fields found. ` +
        `${result.stakeholders.all?.length || 0} stakeholders.`
    );
  } catch (err) {
    // NiumAPIError carries the upstream status/body; surface a readable message.
    if (err instanceof NiumAPIError) {
      console.error("[KYCLookupAgent] Nium API error:", err.status, err.body);
      result.error = `Nium API error (${err.status}) on ${err.endpoint}`;
    } else {
      console.error("[KYCLookupAgent] Error:", err.message);
      result.error = err.message;
    }
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

module.exports = {
  kycLookupAgent,
  mapPublicDetails,
  mapExhaustiveDetails,
};
