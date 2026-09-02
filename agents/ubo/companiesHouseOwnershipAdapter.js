"use strict";

const { EDGE_TYPES } = require("./constants");

const BASE = "https://api.company-information.service.gov.uk";
function ownershipMinimum(natures = []) {
  const text = natures.join("|");
  if (text.includes("75-to-100")) return 75;
  if (text.includes("50-to-75")) return 50;
  if (text.includes("25-to-50")) return 25;
  return null;
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

async function companiesHouseOwnershipAdapter({ entity }) {
  if (String(entity.jurisdiction).toUpperCase() !== "GB" || !entity.registrationNumber) return { statements: [], evidence: [], missingInformation: [] };
  if (!process.env.COMPANIES_HOUSE_API_KEY) return { statements: [], evidence: [], missingInformation: [{ entity: entity.name, source: "Companies House", reason: "COMPANIES_HOUSE_API_KEY is not configured" }] };
  const number = String(entity.registrationNumber).padStart(8, "0");
  const url = `${BASE}/company/${encodeURIComponent(number)}/persons-with-significant-control`;
  const response = await fetch(url, { headers: { Authorization: authHeader(), accept: "application/json" } });
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
  const data = await response.json();
  const evidence = [];
  const statements = (data.items || []).flatMap((psc, index) => {
    const minimum = ownershipMinimum(psc.natures_of_control || []);
    if (!minimum || psc.ceased_on) return [];
    const evidenceId = `companies-house:${number}:psc:${index}`;
    evidence.push({ id: evidenceId, source: "Companies House PSC register", sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}/persons-with-significant-control`, sourceReliability: 98, extractionConfidence: 100, jurisdictionRelevant: true, fetchedAt: new Date().toISOString(), ownershipBand: `${minimum}% or more`, naturesOfControl: psc.natures_of_control || [] });
    const corporate = psc.kind === "corporate-entity-person-with-significant-control" || Boolean(psc.identification?.registration_number);
    return [{ id: `${evidenceId}:ownership`, owner: { name: psc.name, type: corporate ? "company" : "individual", registrationNumber: psc.identification?.registration_number || null, jurisdiction: corporate ? jurisdictionFromCompaniesHousePsc(psc, entity.jurisdiction) : "GB" }, ownedEntity: entity, type: EDGE_TYPES.OWNERSHIP, ownershipPercentage: minimum, ownershipIsMinimum: true, evidenceIds: [evidenceId], confidence: 98, metadata: { ownershipIsMinimum: true, ownershipBand: `${minimum}% or more`, naturesOfControl: psc.natures_of_control || [] } }];
  });
  return { statements, evidence, missingInformation: [], sufficient: statements.length > 0, searchEvents: [{ source: "companies_house", entity: entity.name, jurisdiction: "GB", cacheHit: false, outcome: statements.length ? `Official PSC register returned ${statements.length} ownership relationship${statements.length === 1 ? "" : "s"}` : "No usable PSC ownership relationship found" }] };
}

module.exports = { companiesHouseOwnershipAdapter, ownershipMinimum, jurisdictionFromCompaniesHousePsc };
