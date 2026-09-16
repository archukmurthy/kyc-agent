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

const SOURCE_JURISDICTION_CODES = Object.freeze({
  england: "GB", wales: "GB", scotland: "GB", "northern ireland": "GB", "united kingdom": "GB", "great britain": "GB",
  "united states": "US", "united states of america": "US", usa: "US", us: "US",
  denmark: "DK", danmark: "DK", singapore: "SG", ireland: "IE", jersey: "JE", guernsey: "GG", "isle of man": "IM",
  spain: "ES",
});

function jurisdictionFromCompaniesHousePsc(psc, fallback, preserveSourceJurisdiction = false) {
  const country = String(psc.identification?.country_registered || psc.address?.country || "").trim().toLowerCase();
  if (!country) return fallback;
  return SOURCE_JURISDICTION_CODES[country] || (preserveSourceJurisdiction ? country.toUpperCase() : fallback);
}

function companyRegistryContext(profile, registryProfile, number) {
  return {
    legalName: profile.company_name || null,
    registrationNumber: number,
    legalForm: registryProfile?.legalForm || null,
    companyType: registryProfile?.companyType || profile.type || null,
    incorporatedIn: profile.registered_office_address?.country || "United Kingdom",
    jurisdiction: profile.jurisdiction || null,
    registryName: "Companies House",
  };
}

function pscRegistryContext(psc) {
  return {
    legalName: psc.name || null,
    registrationNumber: psc.identification?.registration_number || null,
    legalForm: psc.identification?.legal_form || null,
    governingLaw: psc.identification?.legal_authority || null,
    incorporatedIn: psc.identification?.country_registered || psc.address?.country || null,
    placeRegistered: psc.identification?.place_registered || null,
    registryName: psc.identification?.place_registered || null,
  };
}

function activePscExemption(data = {}) {
  const entries = Object.values(data.exemptions || {}).filter((entry) => String(entry.exemption_type || "").startsWith("psc-exempt"))
    .flatMap((entry) => (entry.items || [])
    .filter((item) => !item.exempt_to)
    .map((item) => ({ exemptionType: entry.exemption_type, effectiveFrom: item.exempt_from })));
  const preferred = entries.find(({ exemptionType }) => exemptionType === "psc-exempt-as-trading-on-eu-regulated-market") || entries[0];
  if (!preferred) return null;
  const reasons = {
    "psc-exempt-as-trading-on-eu-regulated-market": "Voting shares admitted to trading on an EU regulated market",
    "psc-exempt-as-trading-on-regulated-market": "Voting shares admitted to trading on a regulated market",
  };
  return {
    pscStatus: "EXEMPT",
    pscExemptionReason: reasons[preferred.exemptionType] || preferred.exemptionType.replaceAll("-", " "),
    pscExemptionEffectiveFrom: preferred.effectiveFrom,
    pscExemptionType: preferred.exemptionType,
  };
}

async function companiesHouseOwnershipAdapter({ entity, tenantConfig = {}, fetchImpl = fetch }) {
  if (String(entity.jurisdiction).toUpperCase() !== "GB" || !entity.registrationNumber) return { statements: [], evidence: [], missingInformation: [] };
  if (!process.env.COMPANIES_HOUSE_API_KEY) return { statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Companies House", reason: "COMPANIES_HOUSE_API_KEY is not configured" }] };
  const number = normalizeCompaniesHouseNumber(entity.registrationNumber);
  const profileUrl = `${BASE}/company/${encodeURIComponent(number)}`;
  const url = `${BASE}/company/${encodeURIComponent(number)}/persons-with-significant-control`;
  const headers = { Authorization: authHeader(), accept: "application/json" };
  const missingInformation = [];
  const evidence = [];
  const includeRegistryContext = tenantConfig.demoRegistryContext === true;
  let profileData = null;
  let registryProfile = entity.metadata?.registryEntityProfile ? {
    entityProfile: entity.metadata.registryEntityProfile,
    legalForm: entity.metadata.registryLegalForm,
    companyType: entity.metadata.registryCompanyType,
    companySubtype: entity.metadata.registryCompanySubtype,
  } : null;
  if (!registryProfile || includeRegistryContext) {
    try {
      const profileResponse = await fetchImpl(profileUrl, { headers });
      if (profileResponse.ok) {
        profileData = await profileResponse.json();
        registryProfile = registryProfileFromCompanyProfile(profileData);
      }
      else missingInformation.push({ entity: entity.name, source: "Companies House", reason: `Companies House company-profile lookup returned ${profileResponse.status}` });
    } catch (error) {
      missingInformation.push({ entity: entity.name, source: "Companies House", reason: `Companies House company-profile lookup failed: ${error.message}` });
    }
  }
  if (includeRegistryContext && profileData) {
    const evidenceId = `companies-house:${number}:profile`;
    evidence.push({
      id: evidenceId,
      source: "Companies House company profile",
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}`,
      apiPath: `/company/${number}`,
      fetchedAt: new Date().toISOString(),
      registryContextAssertion: {
        subject: { name: profileData.company_name || entity.name, type: "company", registrationNumber: number, jurisdiction: "GB" },
        value: companyRegistryContext(profileData, registryProfile, number),
      },
    });
    if (profileData.links?.exemptions) {
      try {
        const exemptionResponse = await fetchImpl(`${BASE}${profileData.links.exemptions}`, { headers });
        if (exemptionResponse.ok) {
          const exemption = activePscExemption(await exemptionResponse.json());
          if (exemption) evidence.push({
            id: `companies-house:${number}:exemptions`,
            source: "Companies House PSC exemptions",
            sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}/persons-with-significant-control`,
            apiPath: profileData.links.exemptions,
            fetchedAt: new Date().toISOString(),
            registryContextAssertion: {
              subject: { name: profileData.company_name || entity.name, type: "company", registrationNumber: number, jurisdiction: "GB" },
              value: exemption,
            },
          });
        } else missingInformation.push({ entity: entity.name, source: "Companies House", reason: `Companies House PSC-exemptions lookup returned ${exemptionResponse.status}` });
      } catch (error) {
        missingInformation.push({ entity: entity.name, source: "Companies House", reason: `Companies House PSC-exemptions lookup failed: ${error.message}` });
      }
    }
  }
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const configurationFailure = response.status === 401 || response.status === 403;
    return {
      statements: [], evidence,
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
  const statements = (data.items || []).flatMap((psc, index) => {
    const natures = psc.natures_of_control || [];
    if (psc.ceased_on) return [];
    const evidenceId = `companies-house:${number}:psc:${index}`;
    const corporate = psc.kind === "corporate-entity-person-with-significant-control" || Boolean(psc.identification?.registration_number);
    const ownerRegistryProfile = corporate ? registryProfileFromPsc(psc) : null;
    const owner = {
      name: psc.name,
      type: corporate ? "company" : "individual",
      registrationNumber: corporate ? normalizeCompaniesHouseNumber(psc.identification?.registration_number) || null : null,
      jurisdiction: corporate ? jurisdictionFromCompaniesHousePsc(psc, entity.jurisdiction, includeRegistryContext) : "GB",
      ...(ownerRegistryProfile ? { metadata: { registryEntityProfile: ownerRegistryProfile.entityProfile, registryLegalForm: ownerRegistryProfile.legalForm } } : {}),
    };
    evidence.push({
      id: evidenceId,
      source: "Companies House PSC register",
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}/persons-with-significant-control`,
      apiPath: `/company/${number}/persons-with-significant-control`,
      sourceReliability: 98,
      extractionConfidence: 100,
      jurisdictionRelevant: true,
      fetchedAt: new Date().toISOString(),
      naturesOfControl: natures,
      ...(includeRegistryContext && corporate ? { registryContextAssertion: { subject: owner, value: pscRegistryContext(psc) } } : {}),
    });
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
