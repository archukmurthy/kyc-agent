"use strict";

/**
 * Companies House Officers API — Layer 1 (deterministic) director source.
 *
 * Fetches ALL active directors / officers for a UK company straight from the
 * authenticated Companies House REST API — NOT web-search snippets. This is the
 * deterministic backstop for the director_names / directors research field on UK
 * (GB) companies, replacing the snippet-scraping path that returned only the
 * handful of officers visible in a single search result (see the Tesco PLC
 * "1 director" bug).
 *
 * Auth: HTTP Basic, API key as username, empty password — IDENTICAL to
 * agents/ubo/companiesHouseOwnershipAdapter.js.
 *
 * Endpoint: GET /company/{number}/officers?items_per_page=100&start_index=N
 *   - The plain officers listing returns active + resigned officers; we filter
 *     to active only (no `resigned_on`). We deliberately do NOT use
 *     register_view=true / register_type=directors — that view only works for
 *     companies that elected to keep their register at Companies House and
 *     returns empty/4xx for most PLCs.
 *   - Pagination handled automatically via start_index / total_results.
 */

const BASE_URL = "https://api.company-information.service.gov.uk";

/**
 * Build the Basic auth header. Companies House uses the API key as the username
 * and an empty string as the password.
 */
function buildAuthHeader() {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) {
    throw new Error("COMPANIES_HOUSE_API_KEY not set");
  }
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

/**
 * Resolve a company number from a company name via the public search endpoint.
 * Prefers an exact (case-insensitive) name match, falls back to the first
 * result. Returns null when nothing usable is found.
 */
async function resolveCompanyNumber(companyName) {
  try {
    const url =
      `${BASE_URL}/search/companies?q=` +
      encodeURIComponent(companyName) +
      `&items_per_page=5`;

    const res = await fetch(url, {
      headers: { Authorization: buildAuthHeader(), accept: "application/json" },
    });

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[CH Officers] Company search ${res.status} for: ${companyName}`);
      return null;
    }

    const data = await res.json();
    const items = data.items || [];
    const target = String(companyName).toLowerCase().trim();
    const exact = items.find((i) => (i.title || "").toLowerCase().trim() === target);
    const match = exact || items[0];
    return (match && match.company_number) || null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[CH Officers] resolveCompanyNumber error:", err.message);
    return null;
  }
}

/**
 * Fetch every officer for a company number, paging through all results, then
 * return only ACTIVE officers (those without a resigned_on date). Returns null
 * on a hard failure (so the caller can fall back to AI web search); returns an
 * empty array when the company is found but has no active officers.
 *
 * @param {string} companyNumber e.g. "00445790"
 * @returns {Promise<Array|null>} raw Companies House officer items, or null
 */
async function fetchActiveOfficers(companyNumber) {
  const allItems = [];
  let startIndex = 0;
  const pageSize = 100;
  let totalResults = null;

  try {
    // Hard cap on pages as a runaway guard (100 * 50 = 5000 officers).
    for (let page = 0; page < 50; page += 1) {
      const url =
        `${BASE_URL}/company/${encodeURIComponent(companyNumber)}/officers` +
        `?items_per_page=${pageSize}&start_index=${startIndex}`;

      const res = await fetch(url, {
        headers: { Authorization: buildAuthHeader(), accept: "application/json" },
      });

      if (res.status === 401 || res.status === 403) {
        // eslint-disable-next-line no-console
        console.error(
          `[CH Officers] ${res.status} — COMPANIES_HOUSE_API_KEY rejected. It is ` +
            "invalid or not a REST API key. Register a REST key at " +
            "https://developer.company-information.service.gov.uk/"
        );
        return null;
      }
      if (res.status === 404) {
        // eslint-disable-next-line no-console
        console.warn(`[CH Officers] 404 — no officers record for company: ${companyNumber}`);
        return [];
      }
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[CH Officers] HTTP ${res.status} for company: ${companyNumber}`);
        return null;
      }

      const data = await res.json();
      if (totalResults === null) totalResults = data.total_results || 0;
      const items = data.items || [];
      allItems.push(...items);

      startIndex += pageSize;
      if (items.length === 0 || startIndex >= totalResults) break;
    }

    // Active officers only — drop anyone with a resignation date.
    return allItems.filter((o) => !o.resigned_on);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CH Officers] fetchActiveOfficers error:", err.message);
    return null;
  }
}

/**
 * Normalise a Companies House date_of_birth ({ month, year }) to the platform's
 * "YYYY-MM" (or "YYYY" when the month is absent). CH only exposes month + year
 * for individuals, never the day.
 */
function formatDob(dob) {
  if (!dob || !dob.year) return "";
  if (dob.month) return `${dob.year}-${String(dob.month).padStart(2, "0")}`;
  return String(dob.year);
}

/**
 * Map a Companies House officer object onto the platform stakeholder shape
 * (mirrors makeStakeholder in src/pipeline.js so enrichStakeholders /
 * validateAllDirectors / the Confirm + Fill Gaps UI all keep working).
 *
 * @param {Object} officer    a Companies House officer list item
 * @param {string} companyNumber the resolved company number (for the source URL)
 */
function mapOfficerToStakeholder(officer, companyNumber) {
  // The officers listing returns `name` as "SURNAME, Forename Middlename".
  const fullName =
    officer.name ||
    [officer.name_elements && officer.name_elements.forename, officer.name_elements && officer.name_elements.surname]
      .filter(Boolean)
      .join(" ");

  const officerRole = officer.officer_role || "director";
  // Present the role with a leading capital ("director" -> "Director",
  // "corporate-secretary" -> "Corporate secretary").
  const roleLabel = officerRole
    .split("-")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

  const sourceUrl =
    `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/officers`;

  const idSlug =
    (officer.links &&
      officer.links.officer &&
      officer.links.officer.appointments &&
      officer.links.officer.appointments.replace(/[^a-zA-Z0-9]/g, "_")) ||
    `${String(fullName).replace(/\s+/g, "_").toLowerCase()}`;

  return {
    id: `ch_${idSlug}`,
    full_name: fullName,
    role: roleLabel,
    appointment_date: officer.appointed_on || null,
    share_percentage: null,
    source: "Companies House Officers Register",
    sourceUrl,
    sourceTier: "tier1",
    fetchedAt: new Date().toISOString(),
    nationality: officer.nationality || "",
    date_of_birth: formatDob(officer.date_of_birth),
    residential_country: officer.country_of_residence || "",
    id_type: "",
    id_number: "",
    is_pep: null,
    pep_details: "",
    is_company:
      officer.officer_role &&
      (officer.officer_role.includes("corporate") ||
        officer.officer_role.includes("nominee-director-corporate")),
    business_type: "",
    business_registration_number:
      (officer.identification && officer.identification.registration_number) || "",
    registered_country: "",
    positions: [],
    verificationStatus: "verified",
    requiresReview: false,
    customer_confirmed: false,
    customer_rejected: false,
    customer_added: false,
  };
}

/**
 * Main export: get all ACTIVE officers for a UK company by name (or number).
 *
 * Returns null on failure (resolution failure, key rejected, network error) so
 * the caller can fall back to AI web search. Returns an empty array when the
 * company is found but has no active officers.
 *
 * @param {Object} opts
 * @param {string} opts.companyName
 * @param {string} [opts.companyNumber]
 * @returns {Promise<Array|null>} platform-shaped stakeholder objects, or null
 */
async function getActiveOfficers({ companyName, companyNumber } = {}) {
  try {
    let number = companyNumber;
    if (!number) {
      number = await resolveCompanyNumber(companyName);
    }
    if (!number) {
      // eslint-disable-next-line no-console
      console.warn(`[CH Officers] Could not resolve company number for: ${companyName}`);
      return null;
    }
    // Companies House numbers are 8 chars, zero-padded (mirrors the PSC adapter).
    number = String(number).padStart(8, "0");

    // eslint-disable-next-line no-console
    console.log(`[CH Officers] Fetching officers for ${companyName} (${number})`);

    const officers = await fetchActiveOfficers(number);
    if (officers === null) return null; // hard failure → caller falls back to AI

    const stakeholders = officers.map((o) => mapOfficerToStakeholder(o, number));

    // eslint-disable-next-line no-console
    console.log(`[CH Officers] Found ${stakeholders.length} active officer(s) for ${companyName}`);

    return stakeholders;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CH Officers] getActiveOfficers error:", err.message);
    return null;
  }
}

module.exports = {
  getActiveOfficers,
  resolveCompanyNumber,
  fetchActiveOfficers,
  mapOfficerToStakeholder,
};
