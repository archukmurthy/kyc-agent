"use strict";

const { createHash } = require("node:crypto");

const REQUIRED_ATTESTATION_FIELDS = Object.freeze([
  "signatureText",
  "signerName",
  "signerCapacity",
  "asAtDate",
  "declarationText",
  "locator",
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function present(value) { return typeof value === "string" ? value.trim().length > 0 : Boolean(value); }
function stableId(value) {
  return `source-currentness:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
}

function assessSignedOwnershipAttestation({ artifactId, attestation, materialFactIds }) {
  const source = clone(attestation || {});
  const facts = [...new Set(materialFactIds || [])].sort();
  const coveredFactIds = [...new Set(source.scope?.coveredFactIds || [])].sort();
  const missingFields = REQUIRED_ATTESTATION_FIELDS.filter((field) => !present(source[field]));
  const uncoveredFactIds = facts.filter((factId) => !coveredFactIds.includes(factId));
  const sufficient = missingFields.length === 0 && uncoveredFactIds.length === 0 && facts.length > 0;
  const metadata = {
    signatureText: source.signatureText || null,
    signerName: source.signerName || null,
    signerCapacity: source.signerCapacity || null,
    signedDate: source.signedDate || null,
    asAtDate: source.asAtDate || null,
    declarationText: source.declarationText || null,
    scope: source.scope || null,
    locator: source.locator || null,
  };
  return Object.freeze({
    case: sufficient ? "CASE_A" : "CASE_B",
    artifactId,
    metadata,
    materialFactIds: facts,
    coveredFactIds,
    missingFields,
    uncoveredFactIds,
    relationshipCurrentness: sufficient ? "CURRENT" : "UNKNOWN",
    currentnessAssertion: sufficient ? {
      assertionId: stableId({ artifactId, metadata, coveredFactIds }),
      assertionType: "SOURCE_ATTESTED_RELATIONSHIP_CURRENTNESS",
      currentState: "CURRENT",
      asAtDate: source.asAtDate,
      signer: { name: source.signerName, capacity: source.signerCapacity },
      declarationText: source.declarationText,
      coveredFactIds,
      evidenceReference: { artifactId, locator: clone(source.locator) },
    } : null,
    sourceCountContribution: 0,
    reason: sufficient
      ? "The signed declaration explicitly attests the scoped ownership relationships as current at the stated as-at date."
      : "The source does not contain a scoped ownership-currentness declaration; signature, capture and processing dates cannot establish relationship currentness.",
  });
}

module.exports = Object.freeze({ assessSignedOwnershipAttestation });
