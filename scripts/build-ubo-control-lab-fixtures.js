"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { allScenarios } = require("../ubo-control/test-support/scenarioCorpus");

const CATALOGUE = [
  ["LAB01", "S01", "Direct qualifying owner", "One direct natural-person economic owner.", true],
  ["LAB02", "S03", "Multilayer ownership", "A deterministic corporate chain and look-through calculation.", true],
  ["LAB03", "S04", "Multiple ownership paths", "Independent ownership paths aggregate without collapsing.", true],
  ["LAB04", "S10", "Threshold-crossing range", "A range crosses the policy threshold and remains unresolved honestly.", true],
  ["LAB05", "S05", "Unresolved foreign HoldCo", "A foreign corporate branch produces real customer-resolution work.", true],
  ["LAB06", "S06", "Discovery NO_DATA", "No data is distinct from a negative ownership conclusion.", true],
  ["LAB07", "S14", "Voting control", "Voting rights remain separate from economic ownership.", true],
  ["LAB08", "S15", "Appointment and removal control", "Management-body appointment/removal rights are assessed independently.", true],
  ["LAB09", "S16", "Other significant control", "Other means of influence/control remain an explicit basis.", true],
  ["LAB10", "S09", "Conflicting ownership evidence", "Competing assertions remain disputed rather than silently ranked.", true],
  ["LAB11", "S19", "Duplicate corroborating evidence", "Corroborating claims remain auditable without double-counting.", true],
  ["LAB12", "S17", "Trust / specialist route", "Trust roles route through the specialist-review semantics.", true],
  ["LAB13", "S02", "LLP economic interest", "LLP member and surplus-asset semantics remain distinct.", true],
  ["LAB14", "P04", "Nominee arrangement", "Nominee inputs expose the underlying-principal requirement.", true],
  ["LAB15", "P03", "SMO fallback review", "Fallback remains asynchronous and human-authoritative.", true],
  ["LAB16", "S07", "Operational failure", "Provider failures remain operational blockers, not customer facts.", true],
  ["LAB17", "S08", "Explicit identity and claim decisions", "An intentionally unreviewed case exercises both decision consoles.", false],
  ["LAB18", "S05", "Customer correction and before/after resolution", "The primary G5.3C customer-action cycle retains Snapshot A and creates Snapshot B.", true],
];

function build() {
  const scenarios = new Map(allScenarios.map((scenario) => [scenario.id, scenario]));
  return {
    fixtureSetVersion: "ubo-control-lab-fixtures-v1",
    generatedFrom: "ubo-control/test-support/scenarioCorpus",
    fixtures: CATALOGUE.map(([id, sourceScenarioId, label, description, preReviewed]) => {
      const scenario = scenarios.get(sourceScenarioId);
      if (!scenario) throw new Error(`Unknown source scenario ${sourceScenarioId}`);
      return {
        id,
        sourceScenarioId,
        label,
        description,
        preReviewed,
        exercise: id === "LAB18" ? "CUSTOMER_ACTION_CYCLE" : id === "LAB17" ? "EXPLICIT_DECISIONS" : "SNAPSHOT_INSPECTION",
        scenario,
      };
    }),
  };
}

const output = path.join(__dirname, "..", "ubo-control-lab", "fixtures", "scenarios.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(build(), null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${output}\n`);

module.exports = { build };
