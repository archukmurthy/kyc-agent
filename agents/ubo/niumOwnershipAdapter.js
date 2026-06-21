"use strict";

const { kycLookupAgent } = require("../kycLookupAgent");
const { EDGE_TYPES } = require("./constants");

function numericPercentage(value) {
  const parsed = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

/**
 * Live Nium eKYB adapter. It discovers direct, disclosed stakeholders only;
 * recursive traversal is owned by the UBO framework, not by this adapter.
 */
async function niumOwnershipAdapter({ entity }) {
  const result = await kycLookupAgent({
    companyName: entity.name,
    countryCode: entity.jurisdiction,
    registrationNumber: entity.registrationNumber || undefined,
  });
  if (result.error) {
    return { missingInformation: [{ entity: entity.name, source: "Nium KYB", reason: result.error }] };
  }
  const evidenceId = `nium:${result.publicDetailsId || entity.name}`;
  const evidence = [{
    id: evidenceId,
    source: "Nium KYB API",
    sourceUrl: "https://api.nium.com",
    sourceReliability: 90,
    extractionConfidence: 95,
    jurisdictionRelevant: true,
    fetchedAt: result.searchedAt,
  }];
  const statements = (result.stakeholders?.all || []).flatMap((stakeholder, index) => {
    const ownershipPercentage = numericPercentage(stakeholder.share_percentage);
    if (!ownershipPercentage) return [];
    const isCorporate = Boolean(stakeholder.registration_number);
    return [{
      id: `${evidenceId}:ownership:${index}`,
      owner: {
        name: stakeholder.full_name,
        type: isCorporate ? "company" : "individual",
        registrationNumber: stakeholder.registration_number || null,
        jurisdiction: stakeholder.country || stakeholder.residential_country || entity.jurisdiction,
      },
      ownedEntity: entity,
      type: EDGE_TYPES.OWNERSHIP,
      ownershipPercentage,
      evidenceIds: [evidenceId],
      confidence: 90,
    }];
  });
  const missingInformation = [];
  if (!statements.length) {
    missingInformation.push({ entity: entity.name, source: "Nium KYB", reason: "No disclosed shareholders with a usable ownership percentage were returned." });
  }
  return { statements, evidence, missingInformation };
}

module.exports = { niumOwnershipAdapter };
