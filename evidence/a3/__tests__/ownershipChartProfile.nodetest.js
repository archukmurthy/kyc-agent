"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EXTRACTION_QUALITY_STATE,
  OWNERSHIP_CHART_PROFILE,
  assessOwnershipChartCompleteness,
  mergeOwnershipSemanticExtractions,
  normalizePartyInventory,
  requiresTargetedOwnershipVerification,
} = require("../ownershipChartProfile");

function party(inventoryId, visibleLabel, partyType = "natural_person") {
  return { inventoryId, visibleLabel, partyType, sourceLocator: { page: 1 }, disposition: "UNRESOLVED" };
}

function relationship(id, subjectInventoryId, objectInventoryId, relationshipType = "ECONOMIC_OWNERSHIP") {
  return {
    id,
    typedRelationship: {
      relationshipType,
      subject: { partyType: "natural_person", name: subjectInventoryId },
      object: { partyType: "legal_entity", name: objectInventoryId },
      value: { kind: "EXACT", measurementType: "percentage", exact: 25, unit: "percentage_points" },
      sourceSpecificMetadata: { connectorInventoryId: id, subjectInventoryId, objectInventoryId },
    },
  };
}

function canonicalRelationship({ id = "fact-40", valueKind = "EXACT", measurementType = "percentage", exactValue = 40 } = {}) {
  return {
    id,
    supportingArtifactIds: ["artifact-smoke"],
    typedRelationship: {
      relationshipType: "ECONOMIC_OWNERSHIP",
      subjectPartyType: "natural_person",
      subjectSnapshot: { name: "ALICE MORGAN", description: "Natural person", qualifiers: {} },
      objectPartyType: "legal_entity",
      objectSnapshot: { name: "HIGGS LLP", jurisdiction: "GB", qualifiers: {} },
      valueKind,
      measurementType,
      exactValue,
      unit: measurementType === "percentage" ? "percentage_points" : null,
      sourceSpecificMetadata: {},
      qualifications: [],
    },
  };
}

test("validated canonical 40 percent relationship reconciles the complete smoke inventory", () => {
  const locatorLimitation = "A valid document source locator was not returned for supporting Artifact artifact-smoke";
  const assessed = assessOwnershipChartCompleteness({
    artifactId: "artifact-smoke",
    facts: [canonicalRelationship()],
    partyInventory: [party("party-1", "ALICE MORGAN"), party("party-2", "HIGGS LLP", "legal_entity")],
    connectorInventory: [{ connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2", visibleLabel: "OWNS 40% OF SHARES IN", percentageText: "40%", disposition: "RESOLVED" }],
    providerCompleteness: { state: "incomplete", limitations: [locatorLimitation] },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE);
  assert.equal(assessed.metrics.inventoryPartyCount, 2);
  assert.equal(assessed.metrics.extractedTypedRelationshipCount, 1);
  assert.equal(assessed.unresolvedParties.length, 0);
  assert.equal(assessed.unresolvedRelationships.length, 0);
  assert.deepEqual(assessed.blockingLimitations, []);
  assert.deepEqual(assessed.nonBlockingLimitations, [locatorLimitation]);
});

test("one directionally labelled percentage connector reconciles canonical storage without provider endpoint IDs", () => {
  const assessed = assessOwnershipChartCompleteness({
    artifactId: "artifact-smoke",
    facts: [canonicalRelationship()],
    partyInventory: [party("party-1", "ALICE MORGAN"), party("party-2", "HIGGS LLP", "legal_entity")],
    connectorInventory: [{ connectorId: "connector-1", visibleLabel: "OWNS 40% OF SHARES IN", percentageText: "OWNS 40% OF SHARES IN", disposition: "RESOLVED" }],
    providerCompleteness: { state: "complete", limitations: [] },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE);
  assert.equal(assessed.unresolvedRelationships.length, 0);
});

test("genuine smoke-shape completeness gaps remain partial or incomplete", () => {
  const complete = { state: "complete", limitations: [] };
  const base = {
    artifactId: "artifact-smoke", facts: [canonicalRelationship()],
    partyInventory: [party("party-1", "ALICE MORGAN"), party("party-2", "HIGGS LLP", "legal_entity")],
    connectorInventory: [{ connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2", percentageText: "40%" }],
    providerCompleteness: complete, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  };
  const missingParty = assessOwnershipChartCompleteness({ ...base, partyInventory: [party("party-1", "ALICE MORGAN")] });
  assert.equal(missingParty.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.equal(missingParty.relationshipInventoryFailures.length, 1);

  const unknownDirection = assessOwnershipChartCompleteness({ ...base, connectorInventory: [{ connectorId: "connector-1", percentageText: "40%" }] });
  assert.equal(unknownDirection.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.equal(unknownDirection.unresolvedRelationships.length, 1);

  const missingPercentage = assessOwnershipChartCompleteness({ ...base, facts: [canonicalRelationship({ valueKind: "UNKNOWN", measurementType: "none", exactValue: null })] });
  assert.equal(missingPercentage.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.deepEqual(missingPercentage.relationshipCompletenessFailures[0].reasonCodes, ["OWNERSHIP_PERCENTAGE_NOT_ESTABLISHED"]);

  const inventedParty = assessOwnershipChartCompleteness({ ...base, partyInventory: [...base.partyInventory, party("party-3", "INVENTED PERSON")] });
  assert.equal(inventedParty.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.equal(inventedParty.unresolvedParties[0].inventoryId, "party-3");
});

test("five inventoried parties with only four relationship endpoints triggers targeted incompleteness", () => {
  const inventory = [party("p1", "Alice"), party("p2", "Bob"), party("p3", "Carol"), party("p4", "Delta Ltd", "legal_entity"), party("p5", "Small label")];
  const facts = [relationship("c1", "p1", "p4"), relationship("c2", "p2", "p4"), relationship("c3", "p3", "p4")];
  const assessed = assessOwnershipChartCompleteness({ artifactId: "artifact-1", facts, partyInventory: inventory, connectorInventory: [{ connectorId: "c1" }, { connectorId: "c2" }, { connectorId: "c3" }], providerCompleteness: { state: "complete" }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT" });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.equal(assessed.metrics.inventoryPartyCount, 5);
  assert.deepEqual(assessed.unresolvedParties.map(({ inventoryId }) => inventoryId), ["p5"]);
  assert.equal(assessed.metrics.verificationPassUsed, false);
});

test("an ordinary Fact whose typed relationship was rejected remains explicit", () => {
  const assessed = assessOwnershipChartCompleteness({
    artifactId: "artifact-1",
    facts: [{ id: "fact-jane", supportSignals: { typedRelationship: { state: "rejected", limitations: ["direction was not established"] } } }],
    partyInventory: [party("jane", "Jane Smith")],
    connectorInventory: [{ connectorId: "jane-edge", subjectInventoryId: "jane", objectInventoryId: "target" }],
    providerCompleteness: { state: "complete" },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE);
  assert.equal(assessed.relationshipValidationFailures.length, 1);
  assert.equal(assessed.unresolvedParties[0].visibleLabel, "Jane Smith");
});

test("zero relationships is never ordinary success without explicit confirmed absence", () => {
  const incomplete = assessOwnershipChartCompleteness({ artifactId: "artifact-1", facts: [], partyInventory: [], connectorInventory: [], providerCompleteness: { state: "complete" }, ownershipDataStatus: "UNRESOLVED" });
  assert.equal(incomplete.state, EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE);
  const confirmed = assessOwnershipChartCompleteness({ artifactId: "artifact-1", facts: [], partyInventory: [], connectorInventory: [], providerCompleteness: { state: "complete" }, ownershipDataStatus: "NO_OWNERSHIP_RELATIONSHIPS_CONFIRMED" });
  assert.equal(confirmed.state, EXTRACTION_QUALITY_STATE.NO_OWNERSHIP_DATA_CONFIRMED);
});

test("same-name people retain distinct source-scoped identities", () => {
  const inventory = normalizePartyInventory([party("jane-left", "Jane Smith"), party("jane-right", "Jane Smith")], "artifact-1");
  assert.equal(inventory.length, 2);
  assert.notEqual(inventory[0].sourcePartyId, inventory[1].sourcePartyId);
});

test("targeted verification merges a missing relationship without regenerating duplicates", () => {
  const primary = { facts: [relationship("c1", "p1", "target")], requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }], completeness: { state: "incomplete", limitations: ["one item missing"] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT", ownershipPartyInventory: [party("p1", "Alice"), party("p2", "Bob")], ownershipConnectorInventory: [{ connectorId: "c1" }] };
  const verification = { facts: [relationship("c1", "p1", "target"), relationship("c2", "p2", "target")], requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }], completeness: { state: "complete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT", ownershipPartyInventory: [party("p1", "Alice"), party("p2", "Bob")], ownershipConnectorInventory: [{ connectorId: "c1" }, { connectorId: "c2" }] };
  const merged = mergeOwnershipSemanticExtractions(primary, verification);
  assert.equal(merged.facts.length, 2);
  assert.equal(merged.ownershipConnectorInventory.length, 2);
  assert.equal(merged.verificationPassUsed, true);
  assert.equal(OWNERSHIP_CHART_PROFILE.profileVersion, "ownership-chart-extraction-v2");
  assert.equal(OWNERSHIP_CHART_PROFILE.instructionVersion, "ownership-chart-instructions-v3");
  assert.equal(OWNERSHIP_CHART_PROFILE.verificationStrategyVersion, "ownership-chart-targeted-verification-v6");
});

test("targeted verification reconciles namespaced inventory IDs and one unambiguous connector", () => {
  const primary = {
    facts: [], requestedConceptOutcomes: [], completeness: { state: "incomplete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
    ownershipPartyInventory: [party("party_0", "Alice"), party("party_1", "Target Ltd", "legal_entity")],
    ownershipConnectorInventory: [{ connectorId: "connector_0", subjectInventoryId: "party_0", objectInventoryId: "party_1", percentageText: null }],
  };
  const verification = {
    facts: [], requestedConceptOutcomes: [], completeness: { state: "complete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
    ownershipPartyInventory: [party("party:party_0", "Alice"), party("party:party_1", "Target Ltd", "legal_entity")],
    ownershipConnectorInventory: [{ connectorId: "connector:connector_0", percentageText: "40%" }],
  };
  const merged = mergeOwnershipSemanticExtractions(primary, verification);
  assert.equal(merged.ownershipPartyInventory.length, 2);
  assert.deepEqual(merged.ownershipConnectorInventory, [{ connectorId: "connector-0", subjectInventoryId: "party-0", objectInventoryId: "party-1", percentageText: "40%" }]);
  const fact = relationship("fact-1", "Alice", "Target Ltd");
  fact.typedRelationship.sourceSpecificMetadata = {};
  const assessed = assessOwnershipChartCompleteness({
    artifactId: "artifact-1", facts: [fact], partyInventory: merged.ownershipPartyInventory,
    connectorInventory: merged.ownershipConnectorInventory, providerCompleteness: { state: "complete" }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE);
  assert.equal(assessed.metrics.unresolvedConnectorCount, 0);
});

test("a represented connector reconciles its explicit inventory endpoints", () => {
  const assessed = assessOwnershipChartCompleteness({
    facts: [{ typedRelationship: {
      relationshipType: "ECONOMIC_OWNERSHIP",
      subject: { name: "Alice Morgan" },
      object: { name: "Northstar Payments Ltd" },
      value: { kind: "EXACT", measurementType: "percentage", value: 40, unit: "percentage_points" },
      sourceSpecificMetadata: { connectorInventoryId: "connector-1" },
    } }],
    partyInventory: [party("party-1", "Alice Morgan"), party("party-2", "Northstar Payments Ltd", "legal_entity")],
    connectorInventory: [{ connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2", visibleLabel: "OWNS 40% OF SHARES IN", disposition: "RESOLVED" }],
    providerCompleteness: { state: "complete", limitations: [] },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE);
  assert.equal(assessed.unresolvedParties.length, 0);
});

test("verification inventory IDs with different punctuation reconcile by unique visible identity", () => {
  const merged = mergeOwnershipSemanticExtractions({
    facts: [], requestedConceptOutcomes: [], completeness: { state: "incomplete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
    ownershipPartyInventory: [party("party-1", "Alice Morgan"), party("party-2", "Higgs LLP", "legal_entity")],
    ownershipConnectorInventory: [{ connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2", visibleLabel: "OWNS 40% OF SHARES IN" }],
  }, {
    facts: [], requestedConceptOutcomes: [], completeness: { state: "complete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
    ownershipPartyInventory: [party("party_1", "Alice Morgan"), party("party_2", "Higgs LLP", "legal_entity")],
    ownershipConnectorInventory: [{ connectorId: "connector_1", subjectInventoryId: "party_1", objectInventoryId: "party_2", visibleLabel: "OWNS 40% OF SHARES IN" }],
  });
  assert.deepEqual(merged.ownershipPartyInventory.map(({ inventoryId }) => inventoryId), ["party-1", "party-2"]);
  assert.deepEqual(merged.ownershipConnectorInventory.map(({ connectorId, subjectInventoryId, objectInventoryId }) => ({ connectorId, subjectInventoryId, objectInventoryId })), [
    { connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2" },
  ]);
});

test("equivalent padded connector IDs do not create false gaps or a second provider pass", () => {
  const facts = [relationship("fact-1", "party_001", "party_003")];
  facts[0].typedRelationship.sourceSpecificMetadata.connectorInventoryId = "conn_001";
  const assessed = assessOwnershipChartCompleteness({
    artifactId: "artifact-ba",
    facts,
    partyInventory: [party("party_001", "Amelia Hart"), party("party_003", "Northstar Aviation Holdings Ltd", "legal_entity")],
    connectorInventory: [
      { connectorId: "conn_001", subjectInventoryId: "party_001", objectInventoryId: "party_003", disposition: "RESOLVED" },
      { connectorId: "connector_01", subjectInventoryId: "party_01", objectInventoryId: "party_03", percentageText: "55%", disposition: "RESOLVED" },
    ],
    providerCompleteness: { state: "incomplete", limitations: ["image locator missing"] },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.inventory.connectors.length, 1);
  assert.equal(assessed.metrics.unresolvedConnectorCount, 0);
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.equal(requiresTargetedOwnershipVerification(assessed), false);
});

test("a genuine missing connector still requires targeted verification", () => {
  const assessed = assessOwnershipChartCompleteness({
    facts: [relationship("connector-1", "party-1", "party-2")],
    partyInventory: [party("party-1", "Alice"), party("party-2", "Target Ltd", "legal_entity")],
    connectorInventory: [
      { connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2" },
      { connectorId: "connector-2", subjectInventoryId: "party-3", objectInventoryId: "party-2" },
    ],
    providerCompleteness: { state: "incomplete", limitations: [] },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(requiresTargetedOwnershipVerification(assessed), true);
});

test("verification does not duplicate an identical relationship merely because one pass omitted its connector ID", () => {
  const primaryRelationship = relationship("connector-1", "party-1", "party-2");
  const duplicate = structuredClone(primaryRelationship);
  duplicate.id = "verification-fact";
  duplicate.typedRelationship.sourceSpecificMetadata = {};
  const base = {
    requestedConceptOutcomes: [], completeness: { state: "incomplete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
    ownershipPartyInventory: [party("party-1", "party-1"), party("party-2", "party-2", "legal_entity")],
    ownershipConnectorInventory: [{ connectorId: "connector-1", subjectInventoryId: "party-1", objectInventoryId: "party-2" }],
  };
  const merged = mergeOwnershipSemanticExtractions({ ...base, facts: [primaryRelationship] }, { ...base, completeness: { state: "complete", limitations: [] }, facts: [duplicate] });
  assert.equal(merged.facts.length, 1);
  assert.equal(merged.facts[0].typedRelationship.sourceSpecificMetadata.connectorInventoryId, "connector-1");
});
