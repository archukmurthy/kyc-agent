"use strict";

const HIGH_VALUE_DOCUMENTS = {
  trust: { document: "Trust deed and beneficiary schedule", impact: "High" },
  foundation: { document: "Foundation charter and governing-body register", impact: "High" },
  company: { document: "Shareholder register or latest ownership chart", impact: "High" },
  unknown: { document: "Shareholder register or official registry extract", impact: "High" },
};

function ownershipGaps({ result }) {
  const missing = (result.missingInformation || []).map((item) => {
    const node = result.ownershipGraph?.nodes?.find((candidate) => candidate.id === item.entityId);
    const recommendation = HIGH_VALUE_DOCUMENTS[node?.type || "unknown"] || HIGH_VALUE_DOCUMENTS.unknown;
    return { entity: item.entity || node?.name || "Ownership structure", reason: item.reason, ...recommendation };
  });
  if (!missing.length) return { status: result.status === "resolved" ? "resolved" : "partial", missing: [] };
  const needsCustomerEvidence = missing.some((item) => item.impact === "High");
  return { status: needsCustomerEvidence ? "needs_customer_evidence" : "partial", missing };
}

module.exports = { ownershipGaps };
