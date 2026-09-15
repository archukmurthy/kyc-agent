"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CAPABILITY_CONTRACT_VERSION, PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE } = require("../../../ubo-control");
const { createLegacyDiscoveryAdapter } = require("../../../integrations/ubo-control/legacy-discovery");
const { companiesHouseOwnershipAdapter, normalizeCompaniesHouseNumber } = require("../companiesHouseOwnershipAdapter");
const { runUboFramework } = require("../uboOrchestrator");

const PROFILES = Object.freeze({
  SL035224: { company_name: "TDR CAPITAL GENERAL PARTNER V L.P.", type: "limited-partnership", subtype: "private-fund-limited-partnership" },
  OC302604: { company_name: "TDR CAPITAL LLP", type: "llp" },
  SC707592: { company_name: "TDR CAPITAL GENERAL PARTNER V LIMITED", type: "private-limited-guarant-nsc-limited-exemption" },
  13578722: { company_name: "TDR CAPITAL NOMINEES 2021 LIMITED", type: "ltd" },
});

function corporate(name, registrationNumber, legalForm, nature) {
  return {
    kind: "corporate-entity-person-with-significant-control",
    name,
    identification: { registration_number: registrationNumber, country_registered: "United Kingdom", legal_form: legalForm },
    natures_of_control: Array.isArray(nature) ? nature : [nature],
  };
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
  SC707592: [corporate("TDR CAPITAL LLP", "OC302604", "Limited Liability Partnership", [
    "ownership-of-shares-75-to-100-percent",
    "voting-rights-75-to-100-percent",
    "right-to-appoint-and-remove-directors",
  ])],
  13578722: [corporate("TDR CAPITAL LLP", "oc302604", "Limited Liability Partnership", [
    "ownership-of-shares-75-to-100-percent",
    "voting-rights-75-to-100-percent",
    "right-to-appoint-and-remove-directors",
  ])],
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function companiesHouseFixture() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const match = String(url).match(/\/company\/([^/]+)(\/persons-with-significant-control)?$/);
    const registrationNumber = decodeURIComponent(match?.[1] || "").toUpperCase();
    if (!PROFILES[registrationNumber]) return response({}, 404);
    return response(match?.[2] ? { items: PSC[registrationNumber] } : PROFILES[registrationNumber]);
  };
  return { calls, adapter: ({ entity }) => companiesHouseOwnershipAdapter({ entity, fetchImpl }) };
}

async function runRoot(registrationNumber, entityName) {
  const fixture = companiesHouseFixture();
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  try {
    const result = await runUboFramework({
      entityName,
      registrationNumber,
      jurisdiction: "GB",
      tenantConfig: { uboRules: { budgets: { maxEntitiesToInvestigate: 10, maxDocumentsToDownload: 10, maxSearchIterations: 10 } } },
      adapters: { companiesHouse: fixture.adapter },
    });
    return { result, calls: fixture.calls };
  } finally {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
  }
}

function request(subjectRegistrationNumber, subjectName) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `root-invariance:${subjectRegistrationNumber}`,
    caseId: "root-invariance-case",
    informationNeeds: [{ needId: "ownership-control", concepts: ["CURRENT_OWNERSHIP_AND_CONTROL"] }],
    subject: { entityId: "target", name: subjectName, entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: subjectRegistrationNumber }] },
  };
}

async function translate(legacy, subjectRegistrationNumber, subjectName) {
  return createLegacyDiscoveryAdapter({ transport: { async invoke() { return { status: 200, body: legacy }; } } }).discover(request(subjectRegistrationNumber, subjectName));
}

test("Companies House identifiers normalize prefixes while preserving leading zeros", () => {
  assert.equal(normalizeCompaniesHouseNumber(" Oc302604 "), "OC302604");
  assert.equal(normalizeCompaniesHouseNumber("sc707592"), "SC707592");
  assert.equal(normalizeCompaniesHouseNumber("00445790"), "00445790");
});

test("demo registry context preserves IAG source identity without changing its three relationship dimensions", async () => {
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  const psc = corporate("International Consolidated Airlines Group S.A", "M-492,129", "Spanish Public Company-Sociedad Anonima", [
    "ownership-of-shares-75-to-100-percent", "voting-rights-25-to-50-percent", "right-to-appoint-and-remove-directors",
  ]);
  psc.identification = { ...psc.identification, legal_authority: "Law Of Spain", country_registered: "Spain", place_registered: "Madrid Mercantile Register" };
  const fetchImpl = async (url) => response(String(url).endsWith("/persons-with-significant-control")
    ? { items: [psc] }
    : { company_name: "BRITISH AIRWAYS PLC", type: "plc", jurisdiction: "england-wales", registered_office_address: { country: "United Kingdom" } });
  try {
    const result = await companiesHouseOwnershipAdapter({ entity: { name: "BRITISH AIRWAYS PLC", type: "company", jurisdiction: "GB", registrationNumber: "01777777" }, tenantConfig: { demoRegistryContext: true }, fetchImpl });
    assert.equal(result.statements[0].owner.jurisdiction, "ES");
    assert.deepEqual(result.statements.map(({ metadata }) => metadata.relationshipConcept), ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS", "APPOINT_OR_REMOVE_PERSONS"]);
    const context = result.evidence.find(({ registryContextAssertion }) => registryContextAssertion?.subject?.name === psc.name).registryContextAssertion.value;
    assert.deepEqual(context, { legalName: psc.name, registrationNumber: "M-492,129", legalForm: "Spanish Public Company-Sociedad Anonima", governingLaw: "Law Of Spain", incorporatedIn: "Spain", placeRegistered: "Madrid Mercantile Register", registryName: "Madrid Mercantile Register" });
  } finally {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
  }
});

test("demo registry context preserves Law Debenture active PSC exemption as a source fact without creating an owner", async () => {
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/exemptions")) return response({ exemptions: { psc_exempt_as_trading_on_eu_regulated_market: { exemption_type: "psc-exempt-as-trading-on-eu-regulated-market", items: [{ exempt_from: "2021-05-25" }] } } });
    if (String(url).endsWith("/persons-with-significant-control")) return response({ items: [] });
    return response({ company_name: "THE LAW DEBENTURE CORPORATION P.L.C.", type: "plc", jurisdiction: "england-wales", registered_office_address: { country: "United Kingdom" }, links: { exemptions: "/company/00030397/exemptions" } });
  };
  try {
    const result = await companiesHouseOwnershipAdapter({ entity: { name: "THE LAW DEBENTURE CORPORATION P.L.C.", type: "company", jurisdiction: "GB", registrationNumber: "00030397" }, tenantConfig: { demoRegistryContext: true }, fetchImpl });
    assert.equal(result.statements.length, 0);
    const exemption = result.evidence.find(({ id }) => id.endsWith(":exemptions"));
    assert.deepEqual(exemption.registryContextAssertion.value, { pscStatus: "EXEMPT", pscExemptionReason: "Voting shares admitted to trading on an EU regulated market", pscExemptionEffectiveFrom: "2021-05-25", pscExemptionType: "psc-exempt-as-trading-on-eu-regulated-market" });
    assert.equal(exemption.apiPath, "/company/00030397/exemptions");
  } finally {
    if (previousKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
    else process.env.COMPANIES_HOUSE_API_KEY = previousKey;
  }
});

test("OC302604 expands identically as a root and as a recursively discovered control holder", async () => {
  const childRun = await runRoot("SL035224", "TDR CAPITAL GENERAL PARTNER V L.P.");
  const rootRun = await runRoot("OC302604", "TDR CAPITAL LLP");

  assert.equal(childRun.calls.filter((url) => url.endsWith("/company/OC302604/persons-with-significant-control")).length, 1);
  assert.equal(rootRun.calls.filter((url) => url.endsWith("/company/OC302604/persons-with-significant-control")).length, 1);
  assert.deepEqual(childRun.result.expansion.expandedRegistryIds, ["GB:REGISTRY:13578722", "GB:REGISTRY:OC302604", "GB:REGISTRY:SC707592", "GB:REGISTRY:SL035224"]);
  assert.deepEqual(rootRun.result.expansion.expandedRegistryIds, ["GB:REGISTRY:OC302604"]);

  const childOcNodes = childRun.result.ownershipGraph.nodes.filter(({ registrationNumber }) => registrationNumber === "OC302604");
  assert.equal(childOcNodes.length, 1);
  assert.equal(childRun.result.ownershipGraph.nodes.length, 7);
  assert.equal(childRun.result.ownershipGraph.edges.length, 10);

  const childCandidates = await translate(childRun.result, "SL035224", "TDR CAPITAL GENERAL PARTNER V L.P.");
  const rootCandidates = await translate(rootRun.result, "OC302604", "TDR CAPITAL LLP");
  assert.equal(childCandidates.candidateFacts.length, 12, "each distinct source nature is translated once even when legacy edges share one evidence record");
  const votingFrom = (result) => result.candidateFacts.filter((fact) => fact.relationship === RELATIONSHIP_TYPE.VOTING_RIGHTS && fact.object.externalIdentifiers.some(({ value }) => value === "OC302604"));
  assert.equal(votingFrom(childCandidates).length, 3);
  assert.equal(votingFrom(rootCandidates).length, 3);
  votingFrom(childCandidates).forEach((fact) => assert.deepEqual(fact.measurement, { type: PERCENTAGE_VALUE_TYPE.RANGE, lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }));

  const firstLevel = childCandidates.candidateFacts.filter((fact) => fact.object.entityId === "target");
  assert.deepEqual(firstLevel.map(({ relationship }) => relationship).sort(), [RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL].sort());
  assert.equal(firstLevel.find(({ relationship }) => relationship === RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP).qualifiers.economicInterestConcept, "SURPLUS_ASSET_RIGHTS");
  assert.equal(firstLevel.find(({ relationship }) => relationship === RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT).qualifiers.requiresInterpretation, true);
  assert.equal(firstLevel[0].object.entityType, "LLP");
  assert.equal(firstLevel[0].qualifiers.objectRegistryLegalForm, "Limited partnership / PFLP");
});
