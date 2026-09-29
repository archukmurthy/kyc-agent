// A UBO case's resolution, computed from what the case holds: the research,
// the customer's ownership chart, their answers and evidence. The questions
// screen and the server (UBO-13) both compute it here, so there is one
// calculation, not a browser one and a server one that drift apart.
//
// CommonJS on purpose, like the engines it wires together: the browser bundle
// imports it, Node requires it. Pure: no window, no storage, no fetch.

const { buildChartResearchComparison, filterComparisonEntriesRelevantToCustomer, partitionResearchEntriesForComparison } = require("./chartComparison");
const { evaluateOwnershipResolution } = require("./ownershipResolutionEngine");
const { applyCurrentVerificationAssessment } = require("./verificationAssessment");

function allCandidateFacts(result) {
  return (result?.candidateSources || []).flatMap((source) =>
    (source.candidateFacts || []).map((fact) => ({ fact, source })));
}

function chartSourceCoverage(result) {
  if (result?.sourceCoverage?.state) return result.sourceCoverage;
  const graph = result?.sourceGraph;
  const relationships = graph?.relationships || [];
  const subjectEntityId = graph?.subject?.entityId || graph?.subjectEntityId || null;
  if (!relationships.length) return { state: "NO_RELATIONSHIPS", sourceRelationshipCount: 0, subjectConnectedRelationshipCount: 0, disconnectedRelationshipIds: [] };
  const connectedNodes = new Set(subjectEntityId ? [subjectEntityId] : []);
  const connectedRelationships = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const relationship of relationships) {
      const target = relationship.targetEntityId || relationship.objectEntityId;
      const source = relationship.sourceEntityId || relationship.subjectEntityId;
      if (!connectedNodes.has(target)) continue;
      connectedRelationships.add(relationship.relationshipId);
      if (!connectedNodes.has(source)) { connectedNodes.add(source); changed = true; }
    }
  }
  const disconnectedRelationshipIds = relationships.filter(({ relationshipId }) => !connectedRelationships.has(relationshipId)).map(({ relationshipId }) => relationshipId);
  return { state: disconnectedRelationshipIds.length ? "REVIEW_REQUIRED" : "CONNECTED", sourceRelationshipCount: relationships.length, subjectConnectedRelationshipCount: connectedRelationships.size, disconnectedRelationshipIds };
}

/** Everything the engine needs that does not change as the customer answers. */
function caseInputs({ researchResult, chartResult, company }) {
  const researchEntries = partitionResearchEntriesForComparison(filterComparisonEntriesRelevantToCustomer(allCandidateFacts(researchResult), company)).primaryEntries;
  const chartEntries = filterComparisonEntriesRelevantToCustomer((chartResult?.candidateFacts || []).map((fact) => ({ fact, source: { artifactId: fact.evidenceReferences?.[0]?.artifactId || fact.evidenceReferences?.[0]?.referenceId } })), company);
  return {
    rows: buildChartResearchComparison(researchEntries, chartEntries),
    chartAnalysis: chartResult?.chartAnalysis,
    topicActivations: researchResult?.investigationTopicActivations || [],
    analystCustomerRequests: researchResult?.analystCustomerRequests || [],
    ownershipContext: {
      customerDocumentEffectiveDate: chartResult?.certification?.certificationDate || null,
      sourceCoverage: chartSourceCoverage(chartResult),
    },
    customerEntityId: company?.registrationNumber || company?.legalName || "CUSTOMER_ENTITY",
  };
}

/** The engine's view of the case, given the customer's current answers and evidence. */
function evaluateCase(inputs, { answers = {}, evidence = {}, recalculations = {}, now }) {
  return evaluateOwnershipResolution({
    comparisonRows: inputs.rows,
    answers,
    evidence,
    recalculations,
    chartAnalysis: inputs.chartAnalysis,
    topicActivations: inputs.topicActivations,
    analystCustomerRequests: inputs.analystCustomerRequests,
    ownershipContext: inputs.ownershipContext,
    customerEntityId: inputs.customerEntityId,
    now,
  });
}

function customerRecalculationPending(engine, recalculations) {
  return engine.resolutions.some((resolution) => resolution.resultingFact?.qualifiers?.customerResolution === true
    && (!recalculations[resolution.comparisonItemId]?.chartAnalysis || recalculations[resolution.comparisonItemId]?.error));
}

function resolutionTrace({ engine, rows, answers, previousTrace, recalculations, finalized = false, now = new Date().toISOString() }) {
  const baseTrace = {
    contractVersion: "ubo-investigation-trace-v2",
    updatedAt: now,
    policy: engine.policy,
    ownershipResolution: engine.ownershipResolution,
    controlResolution: { ...engine.controlResolution, assessments: engine.controlResolution?.assessments || [] },
    fallback: engine.fallback,
    personOwnershipAssessments: engine.personOwnershipAssessments,
    uboAssessments: engine.uboAssessments,
    auditTrail: engine.auditTrail,
    ownershipFacts: engine.resolutions.map((resolution) => {
      const row = rows.find(({ key }) => key === resolution.comparisonItemId);
      return {
        ...resolution,
        originalComparison: row ? { status: row.status, detail: row.detail, descriptor: row.descriptor } : null,
        customerAssertion: row?.chartFact || null,
        independentAssertion: row?.researchFact || null,
        factRequirements: engine.requirements.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId),
        questions: engine.questions.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId).map((question) => ({ ...question, ...(answers[question.id] ? { answer: answers[question.id].value } : {}) })),
        evidence: engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId),
      };
    }),
    questions: engine.questions.map((question) => ({ ...question, ...(answers[question.id] ? { answer: answers[question.id].value } : {}) })),
    evidence: engine.evidenceRequirements.map((item) => ({ ...item })),
  };
  return applyCurrentVerificationAssessment(baseTrace, previousTrace, { pendingRecalculation: customerRecalculationPending(engine, recalculations), finalized, now });
}

module.exports = {
  allCandidateFacts,
  chartSourceCoverage,
  caseInputs,
  evaluateCase,
  customerRecalculationPending,
  resolutionTrace,
};
