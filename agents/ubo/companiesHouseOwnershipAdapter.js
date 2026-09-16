"use strict";

const { EDGE_TYPES } = require("./constants");

const BASE = "https://api.company-information.service.gov.uk";
function normalizeCompaniesHouseNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^\d+$/.test(normalized) ? normalized.padStart(8, "0") : normalized;
}
function ownershipMinimum(natures = []) {
  const text = natures.join("|");
  if (text.includes("75-to-100")) return 75;
  if (text.includes("50-to-75")) return 50;
  if (text.includes("25-to-50")) return 25;
  return null;
}

function percentageRangeFromNature(nature) {
  const normalized = String(nature).toLowerCase();
  const match = normalized.match(/-(\d+(?:\.\d+)?)-to-(\d+(?:\.\d+)?)-percent(?:age)?(?:-limited-liability-partnership)?$/);
  if (!match) return null;
  const lowerBound = Number(match[1]);
  return {
    lowerBound,
    upperBound: Number(match[2]),
    lowerInclusive: normalized.includes("surplus-assets") && lowerBound === 75,
    upperInclusive: true,
  };
}

function relationshipFromNature(nature) {
  const normalized = String(nature).toLowerCase();
  if (normalized.includes("right-to-share-surplus-assets")) return { type: EDGE_TYPES.OWNERSHIP, concept: "SURPLUS_ASSET_RIGHTS" };
  if (normalized.includes("ownership-of-shares")) return { type: EDGE_TYPES.OWNERSHIP, concept: "ECONOMIC_OWNERSHIP" };
  if (normalized.includes("voting-rights")) return { type: EDGE_TYPES.CONTROL, concept: "VOTING_RIGHTS" };
  if (normalized.includes("right-to-appoint-and-remove")) return { type: EDGE_TYPES.CONTROL, concept: "APPOINT_OR_REMOVE_PERSONS" };
  if (normalized.includes("significant-influence-or-control")) return { type: EDGE_TYPES.CONTROL, concept: "SIGNIFICANT_INFLUENCE_OR_CONTROL" };
  return null;
}

function registryProfileFromCompanyProfile(profile = {}) {
  const type = String(profile.type || "").trim().toLowerCase();
  const subtype = String(profile.subtype || "").trim().toLowerCase();
  if (type === "llp") return { entityProfile: "LLP", legalForm: "Limited liability partnership", companyType: type };
  if (type === "limited-partnership") {
    return {
      entityProfile: "LLP",
      legalForm: subtype.includes("private-fund") ? "Limited partnership / PFLP" : "Limited partnership",
      companyType: type,
      ...(subtype ? { companySubtype: subtype } : {}),
    };
  }
  if (type === "ltd") return { entityProfile: "COMPANY", legalForm: "Private limited company (Ltd)", companyType: type };
  if (type === "plc") return { entityProfile: "COMPANY", legalForm: "Public limited company (PLC)", companyType: type };
  return type ? { entityProfile: "COMPANY", legalForm: type.replaceAll("-", " "), companyType: type, ...(subtype ? { companySubtype: subtype } : {}) } : null;
}

function registryProfileFromPsc(psc = {}) {
  const legalForm = String(psc.identification?.legal_form || "").trim();
  if (!legalForm) return null;
  const normalized = legalForm.toLowerCase();
  return {
    entityProfile: normalized.includes("limited liability partnership") || normalized.includes("limited partnership") ? "LLP" : "COMPANY",
    legalForm,
  };
}
function authHeader() { return `Basic ${Buffer.from(`${process.env.COMPANIES_HOUSE_API_KEY}:`).toString("base64")}`; }

function jurisdictionFromCompaniesHousePsc(psc, fallback) {
  const country = String(psc.identification?.country_registered || psc.address?.country || "").trim().toLowerCase();
  if (!country) return fallback;
  if (["england", "wales", "scotland", "northern ireland", "united kingdom", "great britain"].includes(country)) return "GB";
  if (["united states", "united states of america", "usa", "us"].includes(country)) return "US";
  if (["denmark", "danmark"].includes(country)) return "DK";
  if (country === "singapore") return "SG";
  if (country === "ireland") return "IE";
  if (country === "jersey") return "JE";
  if (country === "guernsey") return "GG";
  if (country === "isle of man") return "IM";
  return fallback;
}

async function companiesHouseOwnershipAdapter({ entity, fetchImpl = fetch }) {
  if (String(entity.jurisdiction).toUpperCase() !== "GB" || !entity.registrationNumber) return { statements: [], evidence: [], missingInformation: [] };
  if (!process.env.COMPANIES_HOUSE_API_KEY) return { statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Companies House", reason: "COMPANIES_HOUSE_API_KEY is not configured" }] };
  const number = normalizeCompaniesHouseNumber(entity.registrationNumber);
  const profileUrl = `${BASE}/company/${encodeURIComponent(number)}`;
  const url = `${BASE}/company/${encodeURIComponent(number)}/persons-with-significant-control`;
  const headers = { Authorization: authHeader(), accept: "application/json" };
  const missingInformation = [];
  let registryProfile = entity.metadata?.registryEntityProfile ? {
    entityProfile: entity.metadata.registryEntityProfile,
    legalForm: entity.metadata.registryLegalForm,
    companyType: entity.metadata.registryCompanyType,
    companySubtype: entity.metadata.registryCompanySubtype,
  } : null;
  if (!registryProfile) {
    try {
      const profileResponse = await fetchImpl(profileUrl, { headers });
      if (profileResponse.ok) registryProfile = registryProfileFromCompanyProfile(await profileResponse.json());
      else missingInformation.push({ entity: entity.name, source: "Companies House", reason: `Companies House company-profile lookup returned ${profileResponse.status}` });
    } catch (error) {
      missingInformation.push({ entity: entity.name, source: "Companies House", reason: `Companies House company-profile lookup failed: ${error.message}` });
    }
  }
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const configurationFailure = response.status === 401 || response.status === 403;
    return {
      statements: [], evidence: [],
      missingInformation: [{ entity: entity.name, source: "Companies House", reason: configurationFailure ? `Companies House API key was rejected (${response.status}). Update COMPANIES_HOUSE_API_KEY before running paid fallback research.` : `Companies House PSC lookup returned ${response.status}` }],
      // Do not spend on a secondary source when the primary-source failure is
      // an account/configuration issue rather than an absence of registry data.
      sufficient: configurationFailure,
      searchEvents: [{ source: "companies_house", entity: entity.name, jurisdiction: "GB", cacheHit: false, outcome: `Official registry unavailable (${response.status})` }],
    };
  }
  const researchedEntity = {
    ...entity,
    registrationNumber: number,
    ...(registryProfile ? { metadata: { ...(entity.metadata || {}), registryEntityProfile: registryProfile.entityProfile, registryLegalForm: registryProfile.legalForm, registryCompanyType: registryProfile.companyType, ...(registryProfile.companySubtype ? { registryCompanySubtype: registryProfile.companySubtype } : {}) } } : {}),
  };
  const data = await response.json();
  const evidence = [];
  const statements = (data.items || []).flatMap((psc, index) => {
    const natures = psc.natures_of_control || [];
    if (psc.ceased_on) return [];
    const evidenceId = `companies-house:${number}:psc:${index}`;
    evidence.push({ id: evidenceId, source: "Companies House PSC register", sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}/persons-with-significant-control`, sourceReliability: 98, extractionConfidence: 100, jurisdictionRelevant: true, fetchedAt: new Date().toISOString(), naturesOfControl: natures });
    const corporate = psc.kind === "corporate-entity-person-with-significant-control" || Boolean(psc.identification?.registration_number);
    const ownerRegistryProfile = corporate ? registryProfileFromPsc(psc) : null;
    const owner = {
      name: psc.name,
      type: corporate ? "company" : "individual",
      registrationNumber: corporate ? normalizeCompaniesHouseNumber(psc.identification?.registration_number) || null : null,
      jurisdiction: corporate ? jurisdictionFromCompaniesHousePsc(psc, entity.jurisdiction) : "GB",
      ...(ownerRegistryProfile ? { metadata: { registryEntityProfile: ownerRegistryProfile.entityProfile, registryLegalForm: ownerRegistryProfile.legalForm } } : {}),
    };
    return natures.flatMap((nature, natureIndex) => {
      const semantic = relationshipFromNature(nature);
      if (!semantic) return [];
      const percentageRange = percentageRangeFromNature(nature);
      const metadata = {
        currentState: "CURRENT",
        relationshipConcept: semantic.concept,
        naturesOfControl: [nature],
        ...(percentageRange ? { percentageRange } : {}),
      };
      if (semantic.type === EDGE_TYPES.OWNERSHIP && percentageRange) {
        metadata.ownershipIsMinimum = true;
        metadata.economicInterestConcept = semantic.concept === "SURPLUS_ASSET_RIGHTS" ? "SURPLUS_ASSET_RIGHTS" : "SHARE_OWNERSHIP";
        metadata.ownershipBand = percentageRange.lowerInclusive
          ? `${percentageRange.lowerBound}% or more`
          : `More than ${percentageRange.lowerBound}% but not more than ${percentageRange.upperBound}%`;
      }
      return [{
        id: `${evidenceId}:${semantic.concept.toLowerCase()}:${natureIndex}`,
        owner,
        ownedEntity: researchedEntity,
        type: semantic.type,
        ownershipPercentage: semantic.type === EDGE_TYPES.OWNERSHIP && percentageRange ? percentageRange.lowerBound : null,
        ownershipIsMinimum: semantic.type === EDGE_TYPES.OWNERSHIP && Boolean(percentageRange),
        evidenceIds: [evidenceId],
        confidence: 98,
        metadata,
      }];
    });
  });
  return { statements, evidence, missingInformation, sufficient: statements.length > 0, searchEvents: [{ source: "companies_house", entity: entity.name, jurisdiction: "GB", registrationNumber: number, cacheHit: false, outcome: statements.length ? `Official PSC register returned ${statements.length} ownership/control relationship${statements.length === 1 ? "" : "s"}` : "No usable PSC ownership/control relationship found" }] };
}

module.exports = { companiesHouseOwnershipAdapter, jurisdictionFromCompaniesHousePsc, normalizeCompaniesHouseNumber, ownershipMinimum, percentageRangeFromNature, registryProfileFromCompanyProfile, registryProfileFromPsc, relationshipFromNature };
