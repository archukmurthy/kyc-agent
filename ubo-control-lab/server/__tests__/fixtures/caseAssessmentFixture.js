"use strict";

// A small, realistic UBO case for the server-calculation tests: independent
// research says Alice Morgan owns 25% of Target Limited, the customer's
// ownership chart says 30%. The discrepancy is what raises a question.

const { reevaluateSavedCustomerOwnershipChart, RESULT_VERSION } = require("../../customerOwnershipChartDemo");

const company = Object.freeze({ legalName: "Target Limited", registrationNumber: "00112233", countryCode: "GB", ownershipType: "PRIVATE_LIMITED" });

function ownershipFact(factId, percentage, reference, target = company) {
  return {
    factId,
    type: "RELATIONSHIP",
    relationship: "ECONOMIC_OWNERSHIP",
    subject: { name: "Alice Morgan", entityType: "NATURAL_PERSON", jurisdiction: "GB" },
    object: { name: target.legalName, entityType: "LEGAL_ENTITY", jurisdiction: "GB", registrationNumber: target.registrationNumber },
    measurement: { type: "EXACT", value: percentage },
    qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
    evidenceReferences: [reference],
  };
}

function chartResult(percentage = 30, target = company) {
  return reevaluateSavedCustomerOwnershipChart({
    demoContext: { demoCaseId: "case-1", referenceCaseId: "", company: target },
    savedResult: {
      contractVersion: RESULT_VERSION,
      company: target,
      artifact: { artifactId: "chart-artifact", digest: "chart-digest", capturedAt: "2026-09-17T09:00:00.000Z" },
      ubo: { operationEvidenceReferences: [], issues: [] },
      candidateFacts: [ownershipFact("chart-fact:alice", percentage, { system: "evidence", referenceType: "ARTIFACT", referenceId: "chart-artifact", artifactId: "chart-artifact" }, target)],
    },
  });
}

function researchResult(percentage = 25, target = company) {
  return {
    status: "COMPLETE",
    sourceMode: "LIVE",
    candidateSources: [{
      sourceId: "companies-house",
      sourceState: "LIVE",
      candidateFacts: [ownershipFact("research-fact:alice", percentage, { system: "companies_house", referenceType: "PSC", referenceId: "psc-alice" }, target)],
    }],
  };
}

function projection({ research = researchResult(), chart = chartResult() } = {}) {
  return { demoCase: { demoCaseId: "case-1", referenceCaseId: "", company }, company, researchResult: research, chartProjection: chart };
}

module.exports = { company, chartResult, researchResult, projection, ownershipFact };
