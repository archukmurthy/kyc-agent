"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { companiesHouseOwnershipAdapter } = require("../../agents/ubo/companiesHouseOwnershipAdapter");
const { runUboFramework } = require("../../agents/ubo/uboOrchestrator");
const { createLegacyDiscoveryAdapter } = require("../../integrations/ubo-control/legacy-discovery");
const { CAPABILITY_CONTRACT_VERSION } = require("../../ubo-control");
const { autoReviewDemoSession, prepareDemoReplayRecord } = require("../server/demoAutoReview");
const { startReviewReplay } = require("../server/reviewLabEngine");

const PROFILES = Object.freeze({
  SL035224: { company_name: "TDR CAPITAL GENERAL PARTNER V L.P.", type: "limited-partnership", subtype: "private-fund-limited-partnership" },
  OC302604: { company_name: "TDR CAPITAL LLP", type: "llp" },
  SC707592: { company_name: "TDR CAPITAL GENERAL PARTNER V LIMITED", type: "private-limited-guarant-nsc-limited-exemption" },
  13578722: { company_name: "TDR CAPITAL NOMINEES 2021 LIMITED", type: "ltd" },
});

function corporate(name, registrationNumber, legalForm, nature) {
  return { kind: "corporate-entity-person-with-significant-control", name, identification: { registration_number: registrationNumber, country_registered: "United Kingdom", legal_form: legalForm }, natures_of_control: Array.isArray(nature) ? nature : [nature] };
}

function person(name) {
  return { kind: "individual-person-with-significant-control", name, natures_of_control: ["voting-rights-25-to-50-percent-limited-liability-partnership"] };
}

const PSC = Object.freeze({
  SL035224: [
    corporate("TDR CAPITAL LLP", " Oc302604 ", "Limited Liability Partnership", "significant-influence-or-control-limited-liability-partnership"),
    corporate("TDR CAPITAL GENERAL PARTNER V LIMITED", "sc707592", "Private Limited Company", "right-to-appoint-and-remove-persons"),
    corporate("TDR CAPITAL NOMINEES 2021 LIMITED", "13578722", "Private Limited Company", "right-to-share-surplus-assets-75-to-100-percent-limited-liability-partnership"),
  ],
  OC302604: [person("MR GARY LINDSAY"), person("MR THOMAS ANDREW MITCHELL"), person("MANJIT DALE")],
  SC707592: [corporate("TDR CAPITAL LLP", "OC302604", "Limited Liability Partnership", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"])],
  13578722: [corporate("TDR CAPITAL LLP", "oc302604", "Limited Liability Partnership", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"])],
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

async function buildTdrDemoSession() {
  const fetchImpl = async (url) => {
    const match = String(url).match(/\/company\/([^/]+)(\/persons-with-significant-control)?$/);
    const registrationNumber = decodeURIComponent(match?.[1] || "").toUpperCase();
    if (!PROFILES[registrationNumber]) return response({}, 404);
    return response(match?.[2] ? { items: PSC[registrationNumber] } : PROFILES[registrationNumber]);
  };
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  try {
    const legacy = await runUboFramework({
      entityName: PROFILES.SL035224.company_name,
      registrationNumber: "SL035224",
      jurisdiction: "GB",
      tenantConfig: { demoRegistryContext: true, uboRules: { budgets: { maxEntitiesToInvestigate: 10, maxDocumentsToDownload: 10, maxSearchIterations: 10 } } },
      adapters: { companiesHouse: ({ entity, tenantConfig }) => companiesHouseOwnershipAdapter({ entity, tenantConfig, fetchImpl }) },
    });
    const subject = { entityId: "target", name: PROFILES.SL035224.company_name, entityType: "LLP", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: "SL035224" }] };
    const request = { contractVersion: CAPABILITY_CONTRACT_VERSION, requestId: "tdr-saved-replay", caseId: "tdr-demo-case", informationNeeds: [{ needId: "ownership-control", concepts: ["CURRENT_OWNERSHIP_AND_CONTROL"] }], subject };
    const discoveryResult = await createLegacyDiscoveryAdapter({ transport: { async invoke() { return { status: 200, body: legacy }; } } }).discover(request);
    const prepared = prepareDemoReplayRecord({ replayId: "tdr-saved-replay", subject, companyContext: { legalEntityName: subject.name, registrationNumber: "SL035224", jurisdiction: "GB", entityProfile: "LLP", riskLevel: "MEDIUM" }, discoveryResult, savedAt: "2026-09-15T08:00:00.000Z" });
    const session = startReviewReplay({ replayRecord: prepared.replayRecord, profileId: "NOT_PROVIDED" });
    session.sourceState = "LIVE";
    session.demoProfileReconciliation = prepared.reconciliation;
    return autoReviewDemoSession(session, "2026-09-15T08:01:00.000Z");
  } finally {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
  }
}

test("saved TDR replay exposes one canonical OC302604 identity and its actual open causes", async () => {
  const session = await buildTdrDemoSession();
  const view = session.snapshots.at(-1).view;
  const tdrLlp = session.entityDirectory.filter(({ party }) => party.externalIdentifiers?.some(({ value }) => String(value).toUpperCase() === "OC302604"));
  assert.equal(tdrLlp.length, 1);
  const open = view.informationNeeds.filter(({ status }) => status === "OPEN");
  assert.equal(open.length, 7);
  assert.deepEqual(open.map(({ concept }) => concept).sort(), [
    "CURRENT_OWNERSHIP_AND_CONTROL", "INDEPENDENT_CORROBORATION", "LAYER_QUALIFIER",
    "LLP_GOVERNANCE_CONTROL_BASIS", "NOMINEE_BEARER_STATUS", "TRUST_STATUS", "VOTING_CONTROL_STATUS",
  ]);
  assert.equal(view.plan.state, "SYSTEM_RESOLUTION");
  assert.equal(view.plan.recommendedActions.length, 4);
  assert.equal(view.plan.customerActions.length, 1);
  assert.equal(view.journeyProjection.customerWorkBundles.length, 0);
  assert.equal(view.journeyProjection.internalReview.requirements.length, 1);
  assert.deepEqual(view.journeyProjection.internalReview.requirements[0].requiredSignoffIds, ["A-06"]);
  assert.equal(view.journeyProjection.policyContentBlocks.length, 3);
  assert.equal(view.journeyProjection.finishLine.currentCustomerBundles, 0);
  assert.equal(view.journeyProjection.finishLine.systemActionsRemaining, 4);
  assert.equal(view.journeyProjection.finishLine.internalReviewPending, 1);
  const llpId = session.entityDirectory.find(({ party }) => party.name === "TDR CAPITAL LLP").entityId;
  const gpId = session.entityDirectory.find(({ party }) => party.name === "TDR CAPITAL GENERAL PARTNER V LIMITED").entityId;
  assert.equal(view.graph.nodes.filter(({ entityId }) => entityId === llpId).length, 1);
  assert.equal(view.graph.nodes.filter(({ entityId }) => entityId === gpId).length, 1);
  assert.notEqual(llpId, gpId, "the similarly named LLP and general-partner company remain distinct registry identities");
});
