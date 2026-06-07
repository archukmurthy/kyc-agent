/**
 * docSearchAgentCall.js
 *
 * Integration snippet — how to call docSearchAgent
 * from the main KYC agent using the KYC agent's
 * own terminology (entityType, ownershipType,
 * effectivelyListed from OWNERSHIP_TYPE_LIBRARY).
 *
 * Drop this into src/App.js or api/research.js
 * when wiring the doc search agent into the
 * main KYC flow.
 *
 * PRODUCTION READINESS NOTE — PR-001:
 * The mapToDocAgentOwnershipType() function below
 * contains hardcoded entity type IDs and ownership
 * type IDs. If an admin adds a new entity type or
 * ownership type via the admin UI, this function
 * will silently misclassify it.
 * See PRODUCTION_READINESS.md PR-001 for the fix.
 */

const { docSearchAgent } = require("./docSearchAgent");
const { OWNERSHIP_TYPE_LIBRARY } = require(
  "../src/utils/ownershipTypes"
);

// ─── Terminology translation ──────────────────────────────────────────────────
//
// Main KYC agent uses:
//   entityType:    "FI" | "Corporate" | "Platform" | "Direct"
//   ownershipType: ids from OWNERSHIP_TYPE_LIBRARY
//                  e.g. "private_limited", "public_listed",
//                       "payment_institution" etc.
//   effectivelyListed: boolean
//                  = isPubliclyListed || isPubliclyListedOverride
//
// Doc search agent expects:
//   niumEntityType: "fi" | "corporate" | "platform" | "direct"
//   ownershipType:  "public_fi" | "fi_only" | "public_only" | "corporate"

// HARDCODED — see PRODUCTION_READINESS.md PR-001
// Replace with config-driven lookup before any live customer data.
function mapToDocAgentOwnershipType(
  ownershipTypeId,
  entityTypeId,
  effectivelyListed
) {
  // FI entity type always maps to FI
  const entityIsFI = entityTypeId === "FI";

  // Ownership types that are always FI
  // regardless of entity type
  const fiOwnershipTypes = new Set([
    "payment_institution",
    "correspondent_bank",
    "investment_fund",
    "insurance_company",
    "central_bank",
  ]);

  const ownershipIsFI = fiOwnershipTypes.has(ownershipTypeId);

  const isFI = entityIsFI || ownershipIsFI;

  const isListed =
    effectivelyListed ||
    ownershipTypeId === "public_listed";

  if (isFI && isListed)  return "public_fi";
  if (isFI && !isListed) return "fi_only";
  if (!isFI && isListed) return "public_only";
  return "corporate";
}

// ─── Generate a temporary case ID ────────────────────────────────────────────
// Replace with dossier.id from the database once
// the submission database (PR-002) is built.

function generateCaseId(companyName, countryCode) {
  const slug = companyName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toLowerCase()
    .slice(0, 30);
  return `${slug}_${countryCode?.toLowerCase()}_${Date.now()}`;
}

// ─── Main call — use this in the KYC agent ───────────────────────────────────

/**
 * Call the doc search agent from the main KYC flow.
 *
 * Call this after Step 1 is complete and these
 * values are confirmed in main agent state:
 *   company.name         - full legal name
 *   company.countryName  - full country name
 *   company.code         - ISO country code
 *   entityType           - "FI"|"Corporate"|"Platform"|"Direct"
 *   ownershipType        - id from OWNERSHIP_TYPE_LIBRARY
 *   effectivelyListed    - isPubliclyListed || isPubliclyListedOverride
 *
 * Can run in parallel with AI enrichment (Layer 3).
 * Do not wait for research to complete first.
 */
async function callDocSearchAgent({
  company,
  entityType,
  ownershipType,
  effectivelyListed,
}) {
  const docAgentOwnershipType = mapToDocAgentOwnershipType(
    ownershipType,
    entityType,
    effectivelyListed
  );

  const caseId = generateCaseId(
    company.name,
    company.code
  );

  console.log(
    `[KYCAgent] Calling docSearchAgent — ` +
    `ownershipType: ${docAgentOwnershipType}`
  );

  const docResult = await docSearchAgent({
    companyName:    company.name,
    country:        company.countryName,
    ownershipType:  docAgentOwnershipType,
    niumEntityType: entityType.toLowerCase(),
    outputDir:      `./downloads/${caseId}`,
  });

  // Merge into submission payload
  // (replace kycDossier with your actual
  //  payload/state object)
  const documentPayload = {
    documents:       docResult.documents,
    documentSummary: docResult.summaryTable,
    documentCost:    docResult.cost,
    caseId,
  };

  // Add doc results to research.found so
  // they appear on the Confirm page:
  // const documentFields = extractFieldsFromDocs(
  //   docResult.documents
  // );
  // setResearch(prev => ({
  //   ...prev,
  //   found: [...prev.found, ...documentFields],
  // }));

  return documentPayload;
}

module.exports = {
  callDocSearchAgent,
  mapToDocAgentOwnershipType,
  generateCaseId,
};
