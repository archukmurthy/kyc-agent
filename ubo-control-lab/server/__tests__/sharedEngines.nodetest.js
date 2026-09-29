"use strict";

// The server recomputes the UBO resolution and assessment with the same code
// the screens use (UBO-13). That only holds while every engine stays loadable
// by Node: one `export` or `import` statement added back turns it into a
// browser-only module and the server silently loses its calculator.

const { test } = require("node:test");
const assert = require("node:assert");

const ENGINES = {
  ownershipResolutionEngine: ["evaluateOwnershipResolution", "evidenceResultStatus"],
  controlDiscoveryEngine: ["extendResolutionWithInvestigation"],
  investigationTopics: ["createTopicActivation"],
  verificationAssessment: ["applyCurrentVerificationAssessment", "completeIdentityVerification"],
  chartComparison: [],
  crossSourcePartyResolution: [],
  idvSubjects: [],
  caseResolution: ["caseInputs", "evaluateCase", "resolutionTrace", "allCandidateFacts", "chartSourceCoverage"],
};

for (const [name, mustExport] of Object.entries(ENGINES)) {
  test(`${name} loads in Node and exports what the server calls`, () => {
    const engine = require(`../../../src/uboDemo/customer/${name}.js`);
    assert.ok(Object.keys(engine).length > 0, `${name} exported nothing`);
    for (const fn of mustExport) assert.strictEqual(typeof engine[fn], "function", `${name}.${fn}`);
  });
}
