/**
 * registryUrlBuilder.js
 * Builds the correct URL per DRS requirement + registry combination.
 *
 * The key insight: different DRS requirements need different pages
 * within the same registry. Legal existence → company overview.
 * Constitution → filing history. Regulatory status → regulator register.
 * Signatory authority → officers page.
 *
 * Two modes:
 *   buildFirstPassUrl(baseUrl, requirement, companyName)
 *     → name-search URL, used when no registration number is known yet
 *
 *   buildDirectUrl(baseUrl, requirement, companyName, registrationNumber)
 *     → direct company page URL, used on second pass or when reg number
 *       is already in the dossier
 *
 * The orchestrator should:
 *   1. Always call buildFirstPassUrl for the first item (Legal existence)
 *   2. If the extraction returns a registrationNumber, store it
 *   3. Use buildDirectUrl for all subsequent requirements in the same run
 */

// ─── Requirement → page type mapping ─────────────────────────────────────────
// Tells us which section of the registry to target per requirement.
const REQUIREMENT_PAGE = {
  "Legal existence":                 "overview",
  "Constitution":                    "filings",
  "Regulatory status":               "regulator",
  "Ownership / control":             "ownership",
  "UK signatory authority evidence": "officers",
  "Indonesia entity address evidence": "overview",
  "Business activity":               "overview",
};

function getPageType(requirement) {
  return REQUIREMENT_PAGE[requirement] || "overview";
}

// ─── Companies House (UK) ─────────────────────────────────────────────────────
function companiesHouseUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  const regNum  = registrationNumber ? registrationNumber.replace(/\s/g, "") : null;

  switch (pageType) {
    case "overview":
      return regNum
        ? `https://find-and-update.company-information.service.gov.uk/company/${regNum}`
        : `https://find-and-update.company-information.service.gov.uk/search?q=${encoded}`;

    case "filings":
      return regNum
        ? `https://find-and-update.company-information.service.gov.uk/company/${regNum}/filing-history`
        : `https://find-and-update.company-information.service.gov.uk/search?q=${encoded}`;

    case "officers":
      return regNum
        ? `https://find-and-update.company-information.service.gov.uk/company/${regNum}/officers`
        : `https://find-and-update.company-information.service.gov.uk/search?q=${encoded}`;

    case "ownership":
      // PSC register
      return regNum
        ? `https://find-and-update.company-information.service.gov.uk/company/${regNum}/persons-with-significant-control`
        : `https://find-and-update.company-information.service.gov.uk/search?q=${encoded}`;

    case "regulator":
      // FCA register — separate site entirely.
      // NB: no `predefined=ALL` — that param breaks the search page (returns
      // an empty/error result); the register only needs `q`.
      return `https://register.fca.org.uk/s/search?q=${encoded}`;

    default:
      return regNum
        ? `https://find-and-update.company-information.service.gov.uk/company/${regNum}`
        : `https://find-and-update.company-information.service.gov.uk/search?q=${encoded}`;
  }
}

// ─── ACRA BizFile (Singapore) ─────────────────────────────────────────────────
function acraUrl(pageType, companyName, registrationNumber) {
  // ACRA's public search — direct company pages require login
  // Best we can do without auth is the search page
  return `https://www.bizfile.gov.sg/ngbbizfileinternet/faces/oracle/webcenter/portalapp/pages/BizfileHomepage.jspx`;
}

// ─── ASIC (Australia) ─────────────────────────────────────────────────────────
function asicUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  if (registrationNumber) {
    const acn = registrationNumber.replace(/\s/g, "");
    return `https://asic.gov.au/online-services/search-asics-registers/companies/?q=${acn}`;
  }
  return `https://asic.gov.au/online-services/search-asics-registers/companies/?q=${encoded}`;
}

// ─── NZ Companies Office ──────────────────────────────────────────────────────
function nzUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  if (registrationNumber) {
    return `https://companies-register.companiesoffice.govt.nz/companies/app/ui/pages/companies/${registrationNumber}/detail`;
  }
  return `https://companies-register.companiesoffice.govt.nz/companies/app/ui/pages/companies/search?q=${encoded}`;
}

// ─── KvK (Netherlands) ────────────────────────────────────────────────────────
function kvkUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  if (registrationNumber) {
    return `https://www.kvk.nl/zoeken/?q=${registrationNumber}`;
  }
  return `https://www.kvk.nl/zoeken/?q=${encoded}`;
}

// ─── SEC EDGAR (USA) ──────────────────────────────────────────────────────────
function secUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  switch (pageType) {
    case "filings":
      return `https://www.sec.gov/cgi-bin/browse-edgar?company=${encoded}&type=10-K&action=getcompany`;
    case "overview":
    default:
      return `https://www.sec.gov/cgi-bin/browse-edgar?company=${encoded}&type=&action=getcompany`;
  }
}

// ─── Corporations Canada ──────────────────────────────────────────────────────
function canadaUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  return `https://ised-isde.canada.ca/cbr-rec/en/home?q=${encoded}`;
}

// ─── SSM Malaysia ─────────────────────────────────────────────────────────────
function ssmUrl(pageType, companyName, registrationNumber) {
  // SSM public search requires registration number for direct lookup
  return `https://www.ssm-einfo.my/`;
}

// ─── AHU Indonesia ────────────────────────────────────────────────────────────
function ahuUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  if (registrationNumber) {
    return `https://ahu.go.id/pencarian/profil-pt?ahu=${encodeURIComponent(registrationNumber)}`;
  }
  return `https://ahu.go.id/pencarian/profil-pt?nama=${encoded}`;
}

// ─── Centre of Registers (Lithuania) ─────────────────────────────────────────
function lithuaniaUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(registrationNumber || companyName);
  return `https://www.registrucentras.lt/jar/p_en/index.php?kodas=${encoded}`;
}

// ─── Handelsregister (Germany) ────────────────────────────────────────────────
function germanyUrl(pageType, companyName, registrationNumber) {
  const encoded = encodeURIComponent(companyName);
  return `https://www.handelsregister.de/rp_web/mask.do?Typ=n&Schlagwoerter=${encoded}`;
}

// ─── FCA register (standalone — used for Regulatory status across UK) ─────────
function fcaUrl(companyName) {
  // No `predefined=ALL` — that param breaks the FCA search page; only `q` is needed.
  return `https://register.fca.org.uk/s/search?q=${encodeURIComponent(companyName)}`;
}

// ─── MAS register (Singapore regulatory status) ───────────────────────────────
function masUrl(companyName) {
  return `https://eservices.mas.gov.sg/fid/institution/detail/search?q=${encodeURIComponent(companyName)}`;
}

// ─── ASIC licence search (Australia regulatory status) ───────────────────────
function asicLicenceUrl(companyName) {
  return `https://asic.gov.au/online-services/search-asics-registers/search-financial-services-licensees-and-representatives/?q=${encodeURIComponent(companyName)}`;
}

// ─── Master dispatcher ────────────────────────────────────────────────────────
/**
 * buildRegistryUrl
 *
 * @param {string} baseUrl              - sourceUrl from DRS checklist item
 * @param {string} requirement          - DRS requirement name
 * @param {string} companyName
 * @param {string|null} registrationNumber  - use when available for direct URLs
 * @returns {string}                    - the most targeted URL for this requirement
 */
function buildRegistryUrl(baseUrl, requirement, companyName, registrationNumber = null) {
  const pageType = getPageType(requirement);
  const encoded  = encodeURIComponent(companyName);

  // ── UK ────────────────────────────────────────────────────────────────────
  if (baseUrl.includes("find-and-update.company-information.service.gov.uk")) {
    // Regulatory status → FCA register (different site entirely)
    if (pageType === "regulator") return fcaUrl(companyName);
    return companiesHouseUrl(pageType, companyName, registrationNumber);
  }

  // ── Singapore ────────────────────────────────────────────────────────────
  if (baseUrl.includes("bizfile.gov.sg")) {
    if (pageType === "regulator") return masUrl(companyName);
    return acraUrl(pageType, companyName, registrationNumber);
  }

  // ── Australia ─────────────────────────────────────────────────────────────
  if (baseUrl.includes("asic.gov.au")) {
    if (pageType === "regulator") return asicLicenceUrl(companyName);
    return asicUrl(pageType, companyName, registrationNumber);
  }

  // ── New Zealand ───────────────────────────────────────────────────────────
  if (baseUrl.includes("companies-register.companiesoffice.govt.nz"))
    return nzUrl(pageType, companyName, registrationNumber);

  // ── Netherlands ───────────────────────────────────────────────────────────
  if (baseUrl.includes("kvk.nl"))
    return kvkUrl(pageType, companyName, registrationNumber);

  // ── Germany ───────────────────────────────────────────────────────────────
  if (baseUrl.includes("handelsregister.de"))
    return germanyUrl(pageType, companyName, registrationNumber);

  // ── USA ───────────────────────────────────────────────────────────────────
  if (baseUrl.includes("sec.gov") || baseUrl.includes("sba.gov"))
    return secUrl(pageType, companyName, registrationNumber);

  // ── Canada ────────────────────────────────────────────────────────────────
  if (baseUrl.includes("ised-isde.canada.ca") || baseUrl.includes("cbr-rec"))
    return canadaUrl(pageType, companyName, registrationNumber);

  // ── Malaysia ──────────────────────────────────────────────────────────────
  if (baseUrl.includes("ssm-einfo.my"))
    return ssmUrl(pageType, companyName, registrationNumber);

  // ── Indonesia ─────────────────────────────────────────────────────────────
  if (baseUrl.includes("ahu.go.id"))
    return ahuUrl(pageType, companyName, registrationNumber);

  // ── Lithuania ─────────────────────────────────────────────────────────────
  if (baseUrl.includes("registrucentras.lt"))
    return lithuaniaUrl(pageType, companyName, registrationNumber);

  // ── Registries that always need a registration number (second-pass only) ──
  if (baseUrl.includes("touki.or.jp"))   return baseUrl; // Japan — needs Japanese input
  if (baseUrl.includes("receita.fazenda") || baseUrl.includes("cnpjreva")) return baseUrl;
  if (baseUrl.includes("gsxt.gov.cn"))   return baseUrl;

  // Default — return base URL
  return baseUrl;
}

module.exports = { buildRegistryUrl, getPageType, fcaUrl, masUrl };
