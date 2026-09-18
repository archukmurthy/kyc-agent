"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  reevaluateSavedCustomerOwnershipChart,
  RESULT_VERSION,
} = require("../customerOwnershipChartDemo.js");

const company = Object.freeze({
  legalName: "Target Limited",
  registrationNumber: "00112233",
  countryCode: "GB",
  ownershipType: "PRIVATE_LIMITED",
});

function customerDeclarationFact(percentage) {
  return {
    factId: "customer-resolution-fact:alice-target",
    type: "RELATIONSHIP",
    relationship: "ECONOMIC_OWNERSHIP",
    subject: { name: "Alice Morgan", entityType: "NATURAL_PERSON", jurisdiction: "GB" },
    object: { name: "Target Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" },
    measurement: { type: "EXACT", value: percentage },
    qualifiers: {
      currentState: "CURRENT",
      economicInterestConcept: "SHARE_OWNERSHIP",
      customerResolution: true,
      sourceComparisonItemId: "comparison:alice-target",
    },
    evidenceReferences: [{
      system: "ubo-questions-resolution",
      referenceType: "CUSTOMER_DECLARATION",
      referenceId: "question:alice-target-percentage",
    }],
  };
}

function reevaluate(percentage) {
  return reevaluateSavedCustomerOwnershipChart({
    demoContext: { demoCaseId: "resolution-case", referenceCaseId: "CASE-Q1", company },
    savedResult: {
      contractVersion: RESULT_VERSION,
      company,
      artifact: { artifactId: "chart-artifact", digest: "chart-digest", capturedAt: "2026-09-17T09:00:00.000Z" },
      ubo: { operationEvidenceReferences: [], issues: [] },
      candidateFacts: [customerDeclarationFact(percentage)],
    },
  });
}

test("a structured customer resolution fact is consumed by the existing graph and UBO calculator", () => {
  const result = reevaluate(30);
  const relationship = result.chartAnalysis.view.graph.relationships[0];
  const effective = result.chartAnalysis.view.qualificationBases.find(({ route }) => route === "EFFECTIVE_INTEREST");
  const person = result.chartAnalysis.view.qualifications[0];

  assert.equal(result.chartAnalysis.state, "EVALUATED");
  assert.equal(relationship.measurement.value, 30);
  assert.equal(effective.evidenceReferences[0].referenceType, "CUSTOMER_DECLARATION");
  assert.equal(effective.assessmentState, "SATISFIED");
  assert.equal(effective.recordedCalculation.value.value, "30");
  assert.equal(person.routeStatus, "ROUTE_SATISFIED");
});

test("the same existing calculator records a below-threshold effective-interest result without overstating other routes", () => {
  const result = reevaluate(18);
  const effective = result.chartAnalysis.view.qualificationBases.find(({ route }) => route === "EFFECTIVE_INTEREST");
  const person = result.chartAnalysis.view.qualifications[0];

  assert.equal(effective.assessmentState, "NOT_SATISFIED");
  assert.equal(effective.recordedCalculation.value.value, "18");
  assert.equal(person.routeStatus, "INDETERMINATE");
});
