"use strict";

const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
} = require("../contracts/constants");
const { deepFreeze } = require("../internal/validation");
const {
  CAPABILITY,
  FUTURE_EXPECTATION_STATUS,
  SCENARIO_KIND,
} = require("./scenarioHarness");

function party(name, entityType, extra = {}) {
  return { name, entityType, externalIdentifiers: [], ...extra };
}

function externalId(namespace, value) {
  return { namespace, value };
}

function evidence(referenceId, referenceType = "REGISTRY_RECORD", locator = undefined) {
  const reference = { system: "scenario-evidence", referenceType, referenceId };
  if (locator !== undefined) reference.locator = locator;
  return reference;
}

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value };
}

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound,
    upperBound,
    lowerInclusive,
    upperInclusive,
  };
}

function unknown(reason) {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function relationship(factId, subject, relationshipType, object, options = {}) {
  const fact = {
    factId,
    type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
    subject,
    relationship: relationshipType,
    object,
    evidenceReferences: options.evidenceReferences || [],
  };
  if (options.measurement !== undefined) fact.measurement = options.measurement;
  if (options.qualifiers !== undefined) fact.qualifiers = options.qualifiers;
  return fact;
}

function attribute(factId, subject, name, value, evidenceReferences = []) {
  return {
    factId,
    type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
    subject,
    attribute: name,
    value,
    evidenceReferences,
  };
}

function informationNeed(needId, concepts, policyRequirementId) {
  const need = { needId, concepts };
  if (policyRequirementId !== undefined) need.policyRequirementId = policyRequirementId;
  return need;
}

function result(requestId, state, candidateFacts = [], operationEvidenceReferences = [], issues = []) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId,
    outcome: { state },
    candidateFacts,
    operationEvidenceReferences,
    issues,
  };
}

function discoveryStep(id, sequence, subject, informationNeeds, response) {
  const requestId = `${id.toLowerCase()}-discovery-${sequence}`;
  return {
    capability: CAPABILITY.DISCOVERY,
    request: {
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      requestId,
      caseId: `${id.toLowerCase()}-case`,
      informationNeeds,
      subject,
    },
    response: { ...response, requestId },
  };
}

function extractionStep(id, sequence, informationNeeds, artifacts, response) {
  const requestId = `${id.toLowerCase()}-extraction-${sequence}`;
  return {
    capability: CAPABILITY.EXTRACTION,
    request: {
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      requestId,
      caseId: `${id.toLowerCase()}-case`,
      informationNeeds,
      artifactEvidenceReferences: artifacts,
    },
    response: { ...response, requestId },
  };
}

function responseTemplate(state, candidateFacts = [], operationEvidenceReferences = [], issues = []) {
  return result("replaced-by-step", state, candidateFacts, operationEvidenceReferences, issues);
}

function future(expectation) {
  return { status: FUTURE_EXPECTATION_STATUS, expectation };
}

function links(requirementIds, actionTemplateIds = [], evidenceCatalogueKeys = []) {
  return { requirementIds, actionTemplateIds, evidenceCatalogueKeys };
}

function scenario(id, kind, title, purpose, context, policyLinks, steps, invariants, futureExpectations = []) {
  return { id, kind, title, purpose, context, policyLinks, steps, invariants, futureExpectations };
}

const CUSTOMER = party("Example Customer Ltd", "COMPANY", {
  entityId: "entity-customer",
  jurisdiction: "GB",
});
const LLP_CUSTOMER = party("Example Members LLP", "LLP", {
  entityId: "entity-llp-customer",
  jurisdiction: "GB",
});

const coreScenarios = [
  (() => {
    const registry = evidence("s01-register", "REGISTER", { catalogueKey: "register_of_members" });
    const alice = party("Alice Direct", "NATURAL_PERSON", { jurisdiction: "GB" });
    const fact = relationship("s01-direct-share", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, {
      measurement: exact(40),
      qualifiers: { entityProfile: "COMPANY", economicInterestConcept: "SHARE_OWNERSHIP" },
      evidenceReferences: [registry],
    });
    return scenario(
      "S01", SCENARIO_KIND.CORE, "Direct company economic ownership",
      "Represent a natural person's exact direct share interest without qualification.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01"], ["DISCLOSE_SHARE_OWNERSHIP"], ["register_of_members"]),
      [discoveryStep("S01", 1, CUSTOMER, [informationNeed("ownership", ["SHARE_OWNERSHIP"], "UBO-R01")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [fact], [registry]))],
      ["The candidate is a direct ECONOMIC_OWNERSHIP fact with an EXACT value.", "No UBO or threshold result is present."],
      [future("Gate 2 determines whether the exact interest qualifies under the active policy.")],
    );
  })(),
  (() => {
    const agreement = evidence("s02-llp-agreement", "DOCUMENT", { catalogueKey: "llp_agreement" });
    const bob = party("Bob Member", "NATURAL_PERSON", { jurisdiction: "GB" });
    const fact = relationship("s02-surplus-right", bob, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, LLP_CUSTOMER, {
      measurement: exact(30),
      qualifiers: { entityProfile: "LLP", economicInterestConcept: "SURPLUS_ASSET_RIGHTS" },
      evidenceReferences: [agreement],
    });
    return scenario(
      "S02", SCENARIO_KIND.CORE, "Direct LLP economic interest",
      "Represent an exact LLP surplus-asset right without modelling it as company shares.",
      { jurisdiction: "GB", entityProfile: "LLP", customer: LLP_CUSTOMER },
      links(["UBO-R01"], ["DISCLOSE_LLP_SURPLUS_ASSET_RIGHTS"], ["llp_agreement"]),
      [discoveryStep("S02", 1, LLP_CUSTOMER, [informationNeed("economic-interest", ["SURPLUS_ASSET_RIGHTS"], "UBO-R01")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [fact], [agreement]))],
      ["LLP SURPLUS_ASSET_RIGHTS semantics are retained in qualifiers.", "No share-ownership qualifier is introduced."],
      [future("Gate 2 applies the LLP-specific qualifying test.")],
    );
  })(),
  (() => {
    const holdCo = party("HoldCo Ltd", "COMPANY", { entityId: "entity-holdco", jurisdiction: "GB" });
    const alice = party("Alice Layered", "NATURAL_PERSON");
    const holdCoRegister = evidence("s03-holdco-register", "REGISTER", { catalogueKey: "register_of_members" });
    const customerRegister = evidence("s03-customer-register", "REGISTER", { catalogueKey: "register_of_members" });
    const searchLog = evidence("s03-search-log", "OPERATION_LOG");
    const facts = [
      relationship("s03-alice-holdco", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, holdCo, {
        measurement: exact(60), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" }, evidenceReferences: [holdCoRegister],
      }),
      relationship("s03-holdco-customer", holdCo, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, {
        measurement: exact(70), qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP" }, evidenceReferences: [customerRegister],
      }),
    ];
    return scenario(
      "S03", SCENARIO_KIND.CORE, "Multilayer company ownership",
      "Represent two economic relationships across a natural person, HoldCo, and customer.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01", "UBO-R02"], ["DISCLOSE_SHARE_OWNERSHIP"], ["register_of_members"]),
      [discoveryStep("S03", 1, CUSTOMER, [informationNeed("ownership-chain", ["SHARE_OWNERSHIP"], "UBO-R02")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, facts, [holdCoRegister, customerRegister, searchLog]))],
      ["Both directed relationships remain separate and ordered.", "Fact evidence subsets remain distinct from three operation-level references."],
      [future("Gate 2 may multiply the two percentages; G1.2B records no indirect result.")],
    );
  })(),
  (() => {
    const alice = party("Alice Multipath", "NATURAL_PERSON");
    const holdA = party("Path A Holdings", "COMPANY");
    const holdB = party("Path B Holdings", "COMPANY");
    const evA = evidence("s04-path-a", "REGISTER", { catalogueKey: "register_of_members" });
    const evB = evidence("s04-path-b", "REGISTER", { catalogueKey: "register_of_members" });
    const facts = [
      relationship("s04-alice-a", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, holdA, { measurement: exact(50), evidenceReferences: [evA] }),
      relationship("s04-a-customer", holdA, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(30), evidenceReferences: [evA] }),
      relationship("s04-alice-b", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, holdB, { measurement: exact(40), evidenceReferences: [evB] }),
      relationship("s04-b-customer", holdB, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(20), evidenceReferences: [evB] }),
    ];
    return scenario(
      "S04", SCENARIO_KIND.CORE, "Multiple independent paths to one person",
      "Preserve two independent candidate paths without collapsing or aggregating them.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R02"], [], ["register_of_members"]),
      [discoveryStep("S04", 1, CUSTOMER, [informationNeed("independent-paths", ["SHARE_OWNERSHIP"], "UBO-R02")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, facts, [evA, evB]))],
      ["Four source-directed facts remain present in original order.", "No aggregate percentage field exists."],
      [future("Gate 2 applies independent-path aggregation and duplicate-interest doctrine.")],
    );
  })(),
  (() => {
    const foreignHoldCo = party("Overseas Holdings SA", "COMPANY", { jurisdiction: "LU" });
    const registry = evidence("s05-foreign-registry", "REGISTRY_EXTRACT", { catalogueKey: "foreign_registry_extract" });
    const fact = relationship("s05-foreign-customer", foreignHoldCo, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, {
      measurement: exact(80),
      qualifiers: { crossBorder: true, ownerResolution: "UNRESOLVED" },
      evidenceReferences: [registry],
    });
    return scenario(
      "S05", SCENARIO_KIND.CORE, "Cross-border unresolved corporate layer",
      "Preserve a foreign corporate holder while upstream natural persons remain unknown.",
      { jurisdiction: "GB", entityProfile: "COMPANY", crossBorder: true, customer: CUSTOMER },
      links(["UBO-R01", "UBO-R02", "UBO-R13"], ["DISCLOSE_SHARE_OWNERSHIP"], ["foreign_registry_extract"]),
      [discoveryStep("S05", 1, CUSTOMER, [informationNeed("ultimate-owners", ["ULTIMATE_NATURAL_PERSONS"], "UBO-R01")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.PARTIAL, [fact], [registry], [{ code: "UPSTREAM_OWNERS_UNRESOLVED" }]))],
      ["The legal-entity holder remains explicit.", "No invented natural-person candidate is returned."],
      [future("Gate 2 may create an InformationNeed or route specialist review under policy.")],
    );
  })(),
  scenario(
    "S06", SCENARIO_KIND.CORE, "Discovery NO_DATA",
    "Represent a successful discovery operation that found no usable ownership or control facts.",
    { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
    links(["UBO-R10"], [], ["companies_house_record"]),
    [discoveryStep("S06", 1, CUSTOMER, [informationNeed("owners", ["OWNERSHIP", "CONTROL"], "UBO-R10")],
      responseTemplate(CAPABILITY_OUTCOME_STATE.NO_DATA, [], [evidence("s06-search-log", "OPERATION_LOG")]))],
    ["NO_DATA contains zero candidate facts.", "No negative ownership or control assertion is fabricated."],
    [future("Gate 2 must not infer fallback eligibility from NO_DATA alone.")],
  ),
  scenario(
    "S07", SCENARIO_KIND.CORE, "Discovery operational failures",
    "Represent UNAVAILABLE and FAILED as separate operational outcomes.",
    { jurisdiction: "GB", entityProfile: "COMPANY", variants: ["UNAVAILABLE", "FAILED"], customer: CUSTOMER },
    links(["UBO-R01"], [], []),
    [
      discoveryStep("S07", 1, CUSTOMER, [informationNeed("owners-unavailable", ["OWNERSHIP"], "UBO-R01")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.UNAVAILABLE, [], [], [{ code: "SOURCE_TEMPORARILY_UNAVAILABLE", retryable: true }])),
      discoveryStep("S07", 2, CUSTOMER, [informationNeed("owners-failed", ["OWNERSHIP"], "UBO-R01")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.FAILED, [], [], [{ code: "SOURCE_OPERATION_FAILED", retryable: false }])),
    ],
    ["UNAVAILABLE and FAILED remain exact and distinct.", "Neither variant emits candidate facts."],
  ),
  (() => {
    const director = party("Dora Director", "NATURAL_PERSON");
    const record = evidence("s08-company-record", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const fact = attribute("s08-director", director, "DIRECTOR_OF", { entityReference: CUSTOMER }, [record]);
    return scenario(
      "S08", SCENARIO_KIND.CORE, "Partial discovery",
      "Return a useful company relationship while ownership information needs remain unresolved.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01", "UBO-R07"], [], ["companies_house_record"]),
      [discoveryStep("S08", 1, CUSTOMER, [informationNeed("people", ["DIRECTORS", "OWNERS"], "UBO-R07")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.PARTIAL, [fact], [record], [{ code: "OWNERSHIP_UNRESOLVED" }]))],
      ["A useful candidate fact coexists with an unresolved requested concept.", "The result remains PARTIAL."],
    );
  })(),
  (() => {
    const apparentA = party("Alex Morgan", "NATURAL_PERSON", { externalIdentifiers: [externalId("source-a-person", "A-17")] });
    const apparentB = party("Alex Morgan", "NATURAL_PERSON", { externalIdentifiers: [externalId("source-b-person", "B-91")] });
    const evA = evidence("s09-source-a", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const evB = evidence("s09-source-b", "COMMERCIAL_RECORD", { catalogueKey: "commercial_registry_data" });
    const factA = relationship("s09-owner-a", apparentA, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(35), evidenceReferences: [evA] });
    const factB = relationship("s09-owner-b", apparentB, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(55), evidenceReferences: [evB] });
    return scenario(
      "S09", SCENARIO_KIND.CORE, "Conflicting ownership candidates",
      "Preserve conflicting percentages and similarly named candidate parties from independent sources.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R08", "UBO-R09"], [], ["companies_house_record", "commercial_registry_data"]),
      [
        discoveryStep("S09", 1, CUSTOMER, [informationNeed("source-a-owner", ["OWNERSHIP"], "UBO-R08")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [factA], [evA])),
        discoveryStep("S09", 2, CUSTOMER, [informationNeed("source-b-owner", ["OWNERSHIP"], "UBO-R08")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [factB], [evB])),
      ],
      ["Both candidates and their independent evidence remain separate.", "Equal names do not create a canonical identity or a winning fact."],
      [future("Gate 2 adjudicates claim conflict and discrepancy materiality.")],
    );
  })(),
  (() => {
    const alice = party("Alice Ranged", "NATURAL_PERSON");
    const chart = evidence("s10-structure-chart", "DOCUMENT", { catalogueKey: "director_certified_structure_chart" });
    const fact = relationship("s10-range", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, {
      measurement: range(20, 30, false, true), evidenceReferences: [chart],
    });
    return scenario(
      "S10", SCENARIO_KIND.CORE, "Percentage range crossing policy threshold",
      "Preserve a range and endpoint inclusivity where its bounds straddle the policy threshold.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01", "UBO-R02"], [], ["director_certified_structure_chart"]),
      [discoveryStep("S10", 1, CUSTOMER, [informationNeed("ranged-owner", ["OWNERSHIP_PERCENTAGE"], "UBO-R02")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [fact], [chart]))],
      ["RANGE bounds and inclusive/exclusive flags survive unchanged.", "No scalar lower-bound field is produced."],
      [future("Gate 2 applies three-valued threshold reasoning to the range.")],
    );
  })(),
  (() => {
    const holdCo = party("Document HoldCo Ltd", "COMPANY", { jurisdiction: "GB" });
    const alice = party("Alice Documented", "NATURAL_PERSON");
    const registry = evidence("s11-registry", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const document = evidence("s11-customer-chart", "ARTIFACT", { catalogueKey: "director_certified_structure_chart" });
    const extractedPage = evidence("s11-page-2", "ARTIFACT_FRAGMENT", { catalogueKey: "director_certified_structure_chart" });
    const branch = relationship("s11-holdco-customer", holdCo, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, {
      measurement: exact(100), evidenceReferences: [registry],
    });
    const owner = relationship("s11-alice-holdco", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, holdCo, {
      measurement: exact(60), evidenceReferences: [extractedPage],
    });
    const need = informationNeed("resolve-holdco", ["ULTIMATE_NATURAL_PERSONS"], "UBO-R01");
    return scenario(
      "S11", SCENARIO_KIND.CORE, "Customer document adds missing ownership relationship",
      "Sequence partial discovery and complete extraction for the same unresolved corporate branch.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01", "UBO-R02"], ["DISCLOSE_SHARE_OWNERSHIP"], ["companies_house_record", "director_certified_structure_chart"]),
      [
        discoveryStep("S11", 1, CUSTOMER, [need], responseTemplate(CAPABILITY_OUTCOME_STATE.PARTIAL, [branch], [registry], [{ code: "HOLDCO_OWNER_UNRESOLVED" }])),
        extractionStep("S11", 1, [need], [document], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [owner], [document, extractedPage])),
      ],
      ["Discovery and Extraction preserve separate results for the same need.", "External artifact references remain opaque and no graph is mutated."],
      [future("Gate 2 joins candidate facts and determines any indirect interest.")],
    );
  })(),
  (() => {
    const document = evidence("s12-share-register", "ARTIFACT", { catalogueKey: "register_of_members" });
    const alice = party("Alice Partial Extract", "NATURAL_PERSON");
    const fact = relationship("s12-owner", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, {
      measurement: unknown("Percentage obscured in supplied scan"), evidenceReferences: [document],
    });
    return scenario(
      "S12", SCENARIO_KIND.CORE, "Partial extraction",
      "Return one ownership candidate while requested voting/control facts remain unavailable.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01", "UBO-R03"], [], ["register_of_members"]),
      [extractionStep("S12", 1, [informationNeed("document-facts", ["OWNERSHIP", "VOTING_RIGHTS"], "UBO-R01")], [document],
        responseTemplate(CAPABILITY_OUTCOME_STATE.PARTIAL, [fact], [document], [{ code: "VOTING_RIGHTS_NOT_EXTRACTED" }]))],
      ["The UNKNOWN measurement is preserved.", "Extraction incompleteness does not fabricate requested facts."],
    );
  })(),
  (() => {
    const document = evidence("s13-unreadable", "ARTIFACT", { catalogueKey: "share_certificates" });
    return scenario(
      "S13", SCENARIO_KIND.CORE, "Extraction operational failure",
      "Represent a failed artifact operation without interpreting failure as document absence.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R01"], [], ["share_certificates"]),
      [extractionStep("S13", 1, [informationNeed("extract-owners", ["OWNERSHIP"], "UBO-R01")], [document],
        responseTemplate(CAPABILITY_OUTCOME_STATE.FAILED, [], [document], [{ code: "ARTIFACT_UNREADABLE", retryable: false }]))],
      ["FAILED remains operational and has no candidate facts.", "The artifact remains operation-level material only."],
    );
  })(),
  (() => {
    const alice = party("Alice Voting", "NATURAL_PERSON");
    const articles = evidence("s14-articles", "DOCUMENT", { catalogueKey: "articles_of_association" });
    const facts = [
      relationship("s14-economic", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(5), evidenceReferences: [articles] }),
      relationship("s14-voting", alice, RELATIONSHIP_TYPE.VOTING_RIGHTS, CUSTOMER, { measurement: exact(40), evidenceReferences: [articles] }),
    ];
    return scenario(
      "S14", SCENARIO_KIND.CORE, "Voting control without equivalent economic ownership",
      "Represent materially different economic and voting candidates for the same person.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R03"], ["DISCLOSE_VOTING_CONTROL"], ["articles_of_association"]),
      [discoveryStep("S14", 1, CUSTOMER, [informationNeed("voting", ["VOTING_RIGHTS", "SHARE_OWNERSHIP"], "UBO-R03")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, facts, [articles]))],
      ["VOTING_RIGHTS is not retyped as ECONOMIC_OWNERSHIP.", "Both bases coexist with their exact measurements."],
      [future("Gate 2 separately evaluates voting and economic qualification.")],
    );
  })(),
  (() => {
    const alice = party("Alice Appointer", "NATURAL_PERSON");
    const managementCo = party("LLP Management Co", "COMPANY", { jurisdiction: "GB" });
    const articles = evidence("s15-articles", "DOCUMENT", { catalogueKey: "articles_of_association" });
    const llpAgreement = evidence("s15-llp-agreement", "DOCUMENT", { catalogueKey: "llp_agreement" });
    const companyFact = relationship("s15-company-appointment", alice, RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, CUSTOMER, {
      qualifiers: { entityProfile: "COMPANY", controlConcept: "BOARD_APPOINTMENT_RIGHTS", scope: "MAJORITY" }, evidenceReferences: [articles],
    });
    const llpFact = relationship("s15-llp-appointment", managementCo, RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, LLP_CUSTOMER, {
      qualifiers: { entityProfile: "LLP", controlConcept: "MANAGEMENT_APPOINTMENT_RIGHTS", managementBody: "persons_entitled_to_participate_in_management", scope: "MAJORITY" }, evidenceReferences: [llpAgreement],
    });
    return scenario(
      "S15", SCENARIO_KIND.CORE, "Appointment and removal control",
      "Represent company board and LLP management appointment semantics as distinct candidate facts.",
      { jurisdiction: "GB", variants: ["COMPANY", "LLP"], customers: [CUSTOMER, LLP_CUSTOMER] },
      links(["UBO-R05"], ["DISCLOSE_APPOINTMENT_REMOVAL_CONTROL"], ["articles_of_association", "llp_agreement"]),
      [
        discoveryStep("S15", 1, CUSTOMER, [informationNeed("company-appointment", ["BOARD_APPOINTMENT_RIGHTS"], "UBO-R05")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [companyFact], [articles])),
        discoveryStep("S15", 2, LLP_CUSTOMER, [informationNeed("llp-appointment", ["MANAGEMENT_APPOINTMENT_RIGHTS"], "UBO-R05")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [llpFact], [llpAgreement])),
      ],
      ["COMPANY and LLP control concepts remain distinct in qualifiers.", "The LLP legal-entity holder remains available for later look-through."],
      [future("Gate 2 determines qualification and projects any controller role.")],
    );
  })(),
  (() => {
    const alice = party("Alice Influence", "NATURAL_PERSON");
    const agreement = evidence("s16-governance", "DOCUMENT", { catalogueKey: "investment_or_governance_agreement" });
    const facts = [
      relationship("s16-economic", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(2), evidenceReferences: [agreement] }),
      relationship("s16-influence", alice, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, CUSTOMER, {
        qualifiers: { ambiguity: "DELIBERATELY_AMBIGUOUS", assertedRight: "veto over strategic decisions" }, evidenceReferences: [agreement],
      }),
    ];
    return scenario(
      "S16", SCENARIO_KIND.CORE, "Other significant influence or control",
      "Preserve a deliberately ambiguous significant-control candidate beside low economic ownership.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R06"], ["DISCLOSE_OTHER_SIGNIFICANT_CONTROL"], ["investment_or_governance_agreement"]),
      [discoveryStep("S16", 1, CUSTOMER, [informationNeed("other-control", ["SIGNIFICANT_INFLUENCE_OR_CONTROL"], "UBO-R06")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.INCONCLUSIVE, facts, [agreement], [{ code: "CONTROL_CLAUSE_AMBIGUOUS" }]))],
      ["Significant control remains a first-class relationship.", "Ambiguity is retained without a controller or review decision."],
      [future("Gate 2 interprets control and decides whether analyst review is required.")],
    );
  })(),
  (() => {
    const trust = party("Example Family Trust", "TRUST", { jurisdiction: "JE" });
    const settlor = party("Sara Settlor", "NATURAL_PERSON");
    const trustee = party("Trustee Services Ltd", "COMPANY", { jurisdiction: "JE" });
    const chart = evidence("s17-trust-chart", "DOCUMENT", { catalogueKey: "director_certified_structure_chart" });
    const facts = [
      relationship("s17-trust-customer", trust, RELATIONSHIP_TYPE.TRUST_OWNERSHIP, CUSTOMER, { measurement: exact(55), evidenceReferences: [chart] }),
      relationship("s17-settlor", settlor, RELATIONSHIP_TYPE.SETTLOR, trust, { evidenceReferences: [chart] }),
      relationship("s17-trustee", trustee, RELATIONSHIP_TYPE.TRUSTEE, trust, { evidenceReferences: [chart] }),
    ];
    return scenario(
      "S17", SCENARIO_KIND.CORE, "Trust or special structure in chain",
      "Represent a trust, settlor, and corporate trustee without pretending the trust is a company.",
      { jurisdiction: "GB", entityProfile: "COMPANY", specialStructure: "TRUST", customer: CUSTOMER },
      links(["UBO-R11"], ["DISCLOSE_TRUST_IN_CHAIN"], ["director_certified_structure_chart"]),
      [discoveryStep("S17", 1, CUSTOMER, [informationNeed("trust-chain", ["TRUST_ROLES", "TRUST_CONTROL"], "UBO-R11")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.PARTIAL, facts, [chart], [{ code: "TRUST_BENEFICIARIES_UNRESOLVED" }]))],
      ["TRUST entity and trust-specific relationships remain explicit.", "No specialist route or ultimate-owner conclusion is emitted."],
      [future("Gate 2 applies special-structure reasoning and any specialist route.")],
    );
  })(),
  (() => {
    const companyA = party("Cycle A Ltd", "COMPANY");
    const companyB = party("Cycle B Ltd", "COMPANY");
    const registry = evidence("s18-cycle-source", "REGISTRY_RECORD", { catalogueKey: "commercial_registry_data" });
    const facts = [
      relationship("s18-a-b", companyA, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, companyB, { measurement: exact(60), evidenceReferences: [registry] }),
      relationship("s18-b-a", companyB, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, companyA, { measurement: exact(60), evidenceReferences: [registry] }),
    ];
    return scenario(
      "S18", SCENARIO_KIND.CORE, "Ownership cycle",
      "Faithfully preserve source assertions that form a directed ownership cycle.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: companyA },
      links(["UBO-R02"], [], ["commercial_registry_data"]),
      [discoveryStep("S18", 1, companyA, [informationNeed("cycle", ["OWNERSHIP_CHAIN"], "UBO-R02")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, facts, [registry]))],
      ["Both directed cycle edges remain unchanged.", "No flattened or calculated ownership fact is produced."],
      [future("Gate 2 detects cycles and produces deterministic non-numeric reasoning.")],
    );
  })(),
  (() => {
    const alice = party("Alice Duplicate Evidence", "NATURAL_PERSON");
    const registry = evidence("s19-registry", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const document = evidence("s19-document", "DOCUMENT", { catalogueKey: "share_certificates" });
    const registryFact = relationship("s19-owner-registry", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(45), evidenceReferences: [registry] });
    const documentFact = relationship("s19-owner-document", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(45), evidenceReferences: [document] });
    return scenario(
      "S19", SCENARIO_KIND.CORE, "Duplicate candidate relationship evidence",
      "Preserve two evidence-backed candidates that may describe the same underlying relationship.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R08"], [], ["companies_house_record", "share_certificates"]),
      [
        discoveryStep("S19", 1, CUSTOMER, [informationNeed("registry-owner", ["OWNERSHIP"], "UBO-R08")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [registryFact], [registry])),
        extractionStep("S19", 1, [informationNeed("document-owner", ["OWNERSHIP"], "UBO-R08")], [document], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [documentFact], [document])),
      ],
      ["Both candidate facts remain present with independent evidence.", "No deduplication or double-counting decision occurs."],
      [future("Gate 2 applies duplicate-interest and corroboration doctrine.")],
    );
  })(),
  (() => {
    const listedCustomer = party("Example Listed plc", "LISTED_COMPANY", { entityId: "entity-listed", jurisdiction: "GB" });
    return scenario(
      "S20", SCENARIO_KIND.CORE, "Listed entity out-of-scope route",
      "Represent a listed-company context while leaving applicability and routing to future policy evaluation.",
      { jurisdiction: "GB", entityProfile: "LISTED_COMPANY", listingMarket: "LSE", customer: listedCustomer },
      links([], [], ["companies_house_record"]),
      [discoveryStep("S20", 1, listedCustomer, [informationNeed("listed-context", ["ENTITY_PROFILE"])],
        responseTemplate(CAPABILITY_OUTCOME_STATE.UNSUPPORTED, [], [], [{ code: "SCENARIO_OUT_OF_SCOPE_CONTEXT" }]))],
      ["The listed entity profile is represented without executing a route.", "The UK pack's out-of-scope definition remains policy data."],
      [future("A future policy evaluator maps this context to the pack's out-of-scope route.")],
    );
  })(),
];

const policyFocusedScenarios = [
  (() => {
    const alice = party("Alice Corroborated", "NATURAL_PERSON");
    const attestation = evidence("p01-attestation", "ATTESTATION", { catalogueKey: "customer_attestation" });
    const registry = evidence("p01-registry", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const attested = relationship("p01-attested-owner", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(30), evidenceReferences: [attestation] });
    const independent = relationship("p01-independent-owner", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(30), evidenceReferences: [registry] });
    return scenario(
      "P01", SCENARIO_KIND.POLICY_FOCUSED, "Declaration and independent corroboration inputs",
      "Provide separate customer-declaration and independent-source candidates without deciding sufficiency.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R08"], [], ["customer_attestation", "companies_house_record"]),
      [
        extractionStep("P01", 1, [informationNeed("declared-owner", ["OWNERSHIP"], "UBO-R08")], [attestation], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [attested], [attestation])),
        discoveryStep("P01", 1, CUSTOMER, [informationNeed("independent-owner", ["OWNERSHIP"], "UBO-R08")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [independent], [registry])),
      ],
      ["Customer and independent evidence remain separate.", "No sufficiency result is emitted."],
      [future("Gate 2 applies the independent-corroboration requirement.")],
    );
  })(),
  (() => {
    const alice = party("Alice PSC", "NATURAL_PERSON");
    const psc = evidence("p02-psc", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const fact = relationship("p02-psc-control", alice, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, CUSTOMER, { evidenceReferences: [psc] });
    return scenario(
      "P02", SCENARIO_KIND.POLICY_FOCUSED, "PSC positive evidence and PSC absence inputs",
      "Represent positive PSC material and a separate no-data lookup without turning absence into a negative fact.",
      { jurisdiction: "GB", entityProfile: "COMPANY", variants: ["PSC_POSITIVE", "PSC_NO_DATA"], customer: CUSTOMER },
      links(["UBO-R06", "UBO-R08"], ["DISCLOSE_OTHER_SIGNIFICANT_CONTROL"], ["companies_house_record"]),
      [
        discoveryStep("P02", 1, CUSTOMER, [informationNeed("psc-positive", ["SIGNIFICANT_CONTROL"], "UBO-R06")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [fact], [psc])),
        discoveryStep("P02", 2, CUSTOMER, [informationNeed("psc-absence", ["SIGNIFICANT_CONTROL"], "UBO-R06")], responseTemplate(CAPABILITY_OUTCOME_STATE.NO_DATA, [], [evidence("p02-psc-search", "OPERATION_LOG")])),
      ],
      ["Positive PSC material is a candidate fact only.", "PSC NO_DATA contains no fabricated negative fact."],
      [future("Gate 2 decides corroborative weight and negative-resolution semantics.")],
    );
  })(),
  scenario(
    "P03", SCENARIO_KIND.POLICY_FOCUSED, "Senior-managing-official fallback precondition inputs",
    "Represent exhausted-measures inputs separately from a no-data capability result without activating fallback.",
    { jurisdiction: "GB", entityProfile: "COMPANY", requiredMeasuresCompleted: false, measuresTaken: ["registry-search"], customer: CUSTOMER },
    links(["UBO-R10"], ["IDENTIFY_SENIOR_MANAGING_OFFICIAL"], ["companies_house_record"]),
    [discoveryStep("P03", 1, CUSTOMER, [informationNeed("fallback-input", ["ULTIMATE_NATURAL_PERSONS"], "UBO-R10")],
      responseTemplate(CAPABILITY_OUTCOME_STATE.NO_DATA, [], [evidence("p03-search", "OPERATION_LOG")]))],
    ["NO_DATA and measures-completed metadata remain separate inputs.", "No fallback or senior-manager result is produced."],
    [future("Gate 2 determines whether every statutory fallback precondition is satisfied.")],
  ),
  (() => {
    const nominee = party("Nominee Holdings Ltd", "COMPANY");
    const nominator = party("Nina Nominator", "NATURAL_PERSON");
    const agreement = evidence("p04-nominee-agreement", "DOCUMENT", { catalogueKey: "shareholders_agreement" });
    const facts = [
      relationship("p04-nominee-owner", nominee, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(30), qualifiers: { nomineeArrangement: true }, evidenceReferences: [agreement] }),
      relationship("p04-nominator-control", nominator, RELATIONSHIP_TYPE.CONTROL_OVER_TRUST_OR_INTERMEDIARY, nominee, { qualifiers: { arrangement: "NOMINEE" }, evidenceReferences: [agreement] }),
    ];
    return scenario(
      "P04", SCENARIO_KIND.POLICY_FOCUSED, "Nominee arrangement inputs",
      "Represent nominee and underlying-control candidates without determining the ultimate qualifying person.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R12"], ["DISCLOSE_NOMINEE_OR_BEARER_ARRANGEMENT"], ["shareholders_agreement"]),
      [extractionStep("P04", 1, [informationNeed("nominee", ["NOMINEE_RELATIONSHIP"], "UBO-R12")], [agreement],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, facts, [agreement]))],
      ["Nominee and underlying-control relationships remain separate.", "No role or UBO status is projected."],
      [future("Gate 2 applies nominee and underlying-interest reasoning.")],
    );
  })(),
  (() => {
    const declarant = party("Customer Declarant", "NATURAL_PERSON", { entityId: "entity-declarant" });
    const attestation = evidence("p05-completeness", "ATTESTATION", { catalogueKey: "customer_attestation" });
    const fact = attribute("p05-completeness-attestation", declarant, "RESIDUAL_COMPLETENESS_ATTESTATION", { answer: "NO_ADDITIONAL_INTERESTS", scope: "OWNERSHIP_AND_CONTROL" }, [attestation]);
    return scenario(
      "P05", SCENARIO_KIND.POLICY_FOCUSED, "Residual completeness attestation input",
      "Represent the completeness backstop as an attributed assertion, not proof of underlying ownership.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R14"], [], ["customer_attestation"]),
      [extractionStep("P05", 1, [informationNeed("completeness", ["RESIDUAL_COMPLETENESS"], "UBO-R14")], [attestation],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [fact], [attestation]))],
      ["The attestation is an entity-attribute candidate, not a negative ownership relationship.", "No requirement is resolved."],
      [future("Gate 2 determines when the completeness backstop is permitted and sufficient.")],
    );
  })(),
  (() => {
    const known = party("Known Qualifying Person", "NATURAL_PERSON", { entityId: "entity-known-person" });
    const registry = evidence("p06-known-person", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const fact = attribute("p06-missing-identity", known, "MISSING_IDENTITY_ATTRIBUTES", ["dateOfBirth", "residentialAddress"], [registry]);
    return scenario(
      "P06", SCENARIO_KIND.POLICY_FOCUSED, "Qualifying-person identity handoff inputs",
      "Represent an already-known canonical party and its missing identity attributes without performing IDV.",
      { jurisdiction: "GB", entityProfile: "COMPANY", customer: CUSTOMER },
      links(["UBO-R07"], ["CAPTURE_QUALIFYING_PERSON_IDENTITY"], ["companies_house_record"]),
      [discoveryStep("P06", 1, CUSTOMER, [informationNeed("identity", ["QUALIFYING_PERSON_IDENTITY"], "UBO-R07")],
        responseTemplate(CAPABILITY_OUTCOME_STATE.PARTIAL, [fact], [registry], [{ code: "IDENTITY_ATTRIBUTES_MISSING" }]))],
      ["The known entityId survives while missing attributes remain explicit.", "No identity matching or verification occurs."],
      [future("A later boundary hands missing identity attributes to downstream KYC policy.")],
    );
  })(),
  (() => {
    const alice = party("Alice Discrepancy", "NATURAL_PERSON");
    const registry = evidence("p07-registry", "REGISTRY_RECORD", { catalogueKey: "companies_house_record" });
    const declaration = evidence("p07-declaration", "ATTESTATION", { catalogueKey: "customer_attestation" });
    const registryFact = relationship("p07-registry-owner", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(20), evidenceReferences: [registry] });
    const declaredFact = relationship("p07-declared-owner", alice, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, CUSTOMER, { measurement: exact(30), evidenceReferences: [declaration] });
    return scenario(
      "P07", SCENARIO_KIND.POLICY_FOCUSED, "Discrepancy comparison inputs",
      "Provide differing registry and customer assertions without determining discrepancy materiality or reporting.",
      { jurisdiction: "GB", entityProfile: "COMPANY", comparisonBasis: ["PSC", "MLR"], customer: CUSTOMER },
      links(["UBO-R09"], [], ["companies_house_record", "customer_attestation"]),
      [
        discoveryStep("P07", 1, CUSTOMER, [informationNeed("registry-comparison", ["OWNERSHIP"], "UBO-R09")], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [registryFact], [registry])),
        extractionStep("P07", 1, [informationNeed("customer-comparison", ["OWNERSHIP"], "UBO-R09")], [declaration], responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [declaredFact], [declaration])),
      ],
      ["Both comparison inputs remain evidence-backed candidates.", "No materiality, rationale, or reporting action is produced."],
      [future("Gate 2 and later integration distinguish definition mismatch, materiality, and reporting workflow.")],
    );
  })(),
  (() => {
    const attestation = evidence("p08-negative-attestation", "ATTESTATION", { catalogueKey: "customer_attestation" });
    const declarant = party("High Risk Declarant", "NATURAL_PERSON", { entityId: "entity-high-risk-declarant" });
    const fact = attribute("p08-negative-answer", declarant, "APPOINTMENT_CONTROL_ATTESTATION", { answer: "NO", riskCheckpoint: "HIGH" }, [attestation]);
    return scenario(
      "P08", SCENARIO_KIND.POLICY_FOCUSED, "High-risk negative-attestation restriction inputs",
      "Represent a high-risk case and negative appointment-control answer without deciding closure or gap status.",
      { jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "HIGH", customer: CUSTOMER },
      links(["UBO-R05"], ["DISCLOSE_APPOINTMENT_REMOVAL_CONTROL"], ["customer_attestation"]),
      [extractionStep("P08", 1, [informationNeed("appointment-attestation", ["APPOINTMENT_CONTROL"], "UBO-R05")], [attestation],
        responseTemplate(CAPABILITY_OUTCOME_STATE.COMPLETE, [fact], [attestation]))],
      ["Risk level and negative answer are separate representable inputs.", "No closure, documentary gap, or routing decision is emitted."],
      [future("Gate 2 applies the high-risk restriction to attestation-based resolution.")],
    );
  })(),
];

const allScenarios = deepFreeze([...coreScenarios, ...policyFocusedScenarios]);

module.exports = {
  allScenarios,
  coreScenarios: deepFreeze(coreScenarios),
  policyFocusedScenarios: deepFreeze(policyFocusedScenarios),
};
