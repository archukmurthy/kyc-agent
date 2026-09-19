"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CAPABILITY_CONTRACT_VERSION, PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE } = require("../../../ubo-control");
const { createLegacyDiscoveryAdapter } = require("../../../integrations/ubo-control/legacy-discovery");
const { companiesHouseOwnershipAdapter, jurisdictionFromCompaniesHousePsc, normalizeCompaniesHouseNumber } = require("../companiesHouseOwnershipAdapter");
const { expandOwnership, expansionEligibility } = require("../recursiveOwnershipExpansionAgent");
const { runUboFramework } = require("../uboOrchestrator");

const PROFILES = Object.freeze({
  SL035224: { company_name: "TDR CAPITAL GENERAL PARTNER V L.P.", type: "limited-partnership", subtype: "private-fund-limited-partnership" },
  OC302604: { company_name: "TDR CAPITAL LLP", type: "llp" },
  SC707592: { company_name: "TDR CAPITAL GENERAL PARTNER V LIMITED", type: "private-limited-guarant-nsc-limited-exemption" },
  13578722: { company_name: "TDR CAPITAL NOMINEES 2021 LIMITED", type: "ltd" },
  OC435996: { company_name: "HIGGS LLP", type: "llp" },
  16543185: { company_name: "PROJECT CASTLE BIDCO LIMITED", type: "ltd" },
  16543048: { company_name: "PROJECT CASTLE FINCO LIMITED", type: "ltd" },
  16542524: { company_name: "PROJECT CASTLE MIDCO LIMITED", type: "ltd" },
  16542425: { company_name: "PROJECT CASTLE TOPCO LIMITED", type: "ltd" },
  16542085: { company_name: "PROJECT CASTLE AEP CO LIMITED", type: "ltd" },
  OC443193: { company_name: "AUGUST EQUITY PARTNERS VI GENERAL PARTNER LLP", type: "llp" },
  14233106: { company_name: "AUGUST EQUITY PARTNERS VI GP LIMITED", type: "ltd" },
  "04261261": { company_name: "AUGUST EQUITY MANAGEMENT LIMITED", type: "ltd" },
  OC313101: { company_name: "AUGUST EQUITY LLP", type: "llp" },
});

function corporate(name, registrationNumber, legalForm, nature, countryRegistered = "United Kingdom") {
  return {
    kind: "corporate-entity-person-with-significant-control",
    name,
    identification: { registration_number: registrationNumber, country_registered: countryRegistered, legal_form: legalForm },
    natures_of_control: Array.isArray(nature) ? nature : [nature],
  };
}

function person(name, nature = "voting-rights-25-to-50-percent-limited-liability-partnership") {
  return { kind: "individual-person-with-significant-control", name, natures_of_control: Array.isArray(nature) ? nature : [nature] };
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
  OC435996: [corporate("PROJECT CASTLE BIDCO LIMITED", "16543185", "Private Limited Company", "significant-influence-or-control-limited-liability-partnership")],
  16543185: [corporate("PROJECT CASTLE FINCO LIMITED", "16543048", "Private Limited Company", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"])],
  16543048: [corporate("PROJECT CASTLE MIDCO LIMITED", "16542524", "Private Limited Company", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"])],
  16542524: [corporate("PROJECT CASTLE TOPCO LIMITED", "16542425", "Private Limited Company", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"])],
  16542425: [corporate("PROJECT CASTLE AEP CO LIMITED", "16542085", "Private Limited Company", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"])],
  16542085: [corporate("AUGUST EQUITY PARTNERS VI GENERAL PARTNER LLP", "OC443193", "Limited Liability Partnership", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent", "right-to-appoint-and-remove-directors"], "England & Wales")],
  OC443193: [corporate("AUGUST EQUITY PARTNERS VI GP LIMITED", "14233106", "Private Limited Company", ["voting-rights-75-to-100-percent-limited-liability-partnership", "right-to-share-surplus-assets-75-to-100-percent-limited-liability-partnership"], "England and Wales")],
  14233106: [corporate("AUGUST EQUITY MANAGEMENT LIMITED", "04261261", "Private Limited Company", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent"])],
  "04261261": [corporate("AUGUST EQUITY LLP", "OC313101", "Limited Liability Partnership", ["ownership-of-shares-75-to-100-percent", "voting-rights-75-to-100-percent"])],
  OC313101: [person("MR DAVID LONSDALE", ["voting-rights-25-to-50-percent-limited-liability-partnership", "right-to-share-surplus-assets-25-to-50-percent-limited-liability-partnership"])],
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
  return { calls, adapter: ({ entity, tenantConfig }) => companiesHouseOwnershipAdapter({ entity, tenantConfig, fetchImpl }) };
}

async function runRoot(registrationNumber, entityName, { demoRegistryContext = false } = {}) {
  const fixture = companiesHouseFixture();
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  try {
    const result = await runUboFramework({
      entityName,
      registrationNumber,
      jurisdiction: "GB",
      tenantConfig: { demoRegistryContext, uboRules: { budgets: { maxEntitiesToInvestigate: 20, maxDocumentsToDownload: 20, maxSearchIterations: 20 } } },
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

test("Companies House canonicalises UK source-jurisdiction variants while registry metadata retains source wording", () => {
  ["England & Wales", "England and Wales", "England-Wales", "England", "Wales", "Scotland", "Northern Ireland", "United Kingdom", "UK", "GB"].forEach((country) => {
    assert.equal(jurisdictionFromCompaniesHousePsc({ identification: { country_registered: country } }, "GB", true), "GB", country);
  });
  assert.equal(jurisdictionFromCompaniesHousePsc({ identification: { country_registered: "Spain" } }, "GB", true), "ES");
});

test("recursive eligibility records distinct natural-person, jurisdiction, type and registration boundaries", () => {
  assert.equal(expansionEligibility({ type: "individual", jurisdiction: "GB" }).code, "NATURAL_PERSON_REACHED");
  assert.equal(expansionEligibility({ type: "company", jurisdiction: "ES", registrationNumber: "A1" }).code, "UNSUPPORTED_JURISDICTION");
  assert.equal(expansionEligibility({ type: "trust", jurisdiction: "GB", registrationNumber: "00112233" }).code, "UNSUPPORTED_ENTITY_TYPE");
  assert.equal(expansionEligibility({ type: "company", jurisdiction: "GB", registrationNumber: "not-valid" }).code, "INVALID_REGISTRATION_NUMBER");
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

test("Companies House preserves the single Law Debenture appoint-or-remove-directors assertion into LDC", async () => {
  const previousKey = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "offline-test-key";
  const psc = corporate("THE LAW DEBENTURE CORPORATION P.L.C.", "00030397", "Public Limited Company", "right-to-appoint-and-remove-directors");
  const fetchImpl = async (url) => response(String(url).endsWith("/persons-with-significant-control")
    ? { items: [psc] }
    : { company_name: "LAW DEBENTURE CORPORATE SERVICES LIMITED", type: "ltd", jurisdiction: "england-wales", registered_office_address: { country: "United Kingdom" } });
  try {
    const result = await companiesHouseOwnershipAdapter({ entity: { name: "LAW DEBENTURE CORPORATE SERVICES LIMITED", type: "company", jurisdiction: "GB", registrationNumber: "07384180" }, tenantConfig: { demoRegistryContext: true }, fetchImpl });
    assert.equal(result.statements.length, 1);
    assert.equal(result.statements[0].owner.registrationNumber, "00030397");
    assert.equal(result.statements[0].ownedEntity.registrationNumber, "07384180");
    assert.equal(result.statements[0].metadata.relationshipConcept, "APPOINT_OR_REMOVE_PERSONS");
    assert.deepEqual(result.statements[0].metadata.naturesOfControl, ["right-to-appoint-and-remove-directors"]);
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

test("Higgs recursively expands England & Wales LLP holders through August Equity to a natural person", async () => {
  const { result, calls } = await runRoot("OC435996", "HIGGS LLP", { demoRegistryContext: true });
  const expanded = new Set(result.expansion.expandedRegistryIds);
  ["OC435996", "16543185", "16543048", "16542524", "16542425", "16542085", "OC443193", "14233106", "04261261", "OC313101"]
    .forEach((number) => assert.ok(expanded.has(`GB:REGISTRY:${number}`), number));
  assert.equal(calls.filter((url) => url.endsWith("/company/OC443193/persons-with-significant-control")).length, 1);

  const august = result.ownershipGraph.nodes.find(({ registrationNumber }) => registrationNumber === "OC443193");
  assert.equal(august.jurisdiction, "GB");
  assert.equal(august.metadata.registryEntityProfile, "LLP");
  assert.ok(result.ownershipGraph.nodes.some(({ name, type }) => name === "MR DAVID LONSDALE" && type === "individual"));
  assert.ok(result.investigationLog.some(({ entity, code }) => entity === "MR DAVID LONSDALE" && code === "NATURAL_PERSON_REACHED"));
  assert.equal(result.missingInformation.some(({ entity }) => /AUGUST EQUITY PARTNERS VI GENERAL PARTNER LLP/i.test(entity || "")), false);

  const concepts = new Set(result.ownershipGraph.edges.map(({ metadata }) => metadata.relationshipConcept));
  ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS", "SURPLUS_ASSET_RIGHTS", "SIGNIFICANT_INFLUENCE_OR_CONTROL"]
    .forEach((concept) => assert.ok(concepts.has(concept), concept));
  const candidates = await translate(result, "OC435996", "HIGGS LLP");
  assert.ok(candidates.candidateFacts.some(({ relationship, qualifiers }) => relationship === RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT && qualifiers.controlConcept === "APPOINT_OR_REMOVE_PERSONS"));
});

test("unsupported recursive jurisdiction produces an explicit terminal reason", async () => {
  const result = await runUboFramework({
    entityName: "UK ROOT LIMITED", registrationNumber: "00112233", jurisdiction: "GB",
    adapters: { registry: async ({ entity }) => ({
      statements: entity.registrationNumber === "00112233" ? [{ owner: { name: "FOREIGN HOLDCO", type: "company", jurisdiction: "ES", registrationNumber: "A123" }, ownedEntity: entity, type: "control", evidenceIds: [] }] : [],
      evidence: [], missingInformation: [], sufficient: true,
    }) },
  });
  assert.ok(result.missingInformation.some(({ entity, code }) => entity === "FOREIGN HOLDCO" && code === "UNSUPPORTED_JURISDICTION"));
  assert.ok(result.investigationLog.some(({ entity, code }) => entity === "FOREIGN HOLDCO" && code === "UNSUPPORTED_JURISDICTION"));
});

test("cycle and budget exhaustion retain distinct recursive termination reasons", async () => {
  const rootEntity = { name: "CYCLE ROOT LIMITED", type: "company", registrationNumber: "00112233", jurisdiction: "GB" };
  const cycle = await expandOwnership({
    rootEntity,
    discovery: async ({ entity }) => ({
      statements: [{ owner: { ...entity }, ownedEntity: entity, type: "control", evidenceIds: [] }],
      evidence: [], missingInformation: [], sufficient: true, providerOutcomes: [], searchEvents: [],
    }),
    adapters: {}, rules: { tenantConfig: {}, discoveryThreshold: 0 },
    budget: { consume: () => true, exhausted: () => false },
  });
  assert.ok(cycle.missingInformation.some(({ code }) => code === "CYCLE_DETECTED"));

  let entitiesInvestigated = 0;
  const budget = await expandOwnership({
    rootEntity: { ...rootEntity, name: "BUDGET ROOT LIMITED" },
    discovery: async ({ entity }) => ({
      statements: entity.registrationNumber === "00112233" ? [{ owner: { name: "NEXT UK HOLDCO LIMITED", type: "company", jurisdiction: "GB", registrationNumber: "00223344" }, ownedEntity: entity, type: "control", evidenceIds: [] }] : [],
      evidence: [], missingInformation: [], sufficient: true, providerOutcomes: [], searchEvents: [],
    }),
    adapters: {}, rules: { tenantConfig: {}, discoveryThreshold: 0 },
    budget: {
      consume: (kind) => kind !== "entitiesInvestigated" || ++entitiesInvestigated <= 1,
      exhausted: () => entitiesInvestigated >= 1,
    },
  });
  assert.ok(budget.missingInformation.some(({ entity, code }) => entity === "NEXT UK HOLDCO LIMITED" && code === "BUDGET_EXHAUSTED"));
  assert.equal(budget.missingInformation.some(({ code }) => code === "CYCLE_DETECTED"), false);
});
