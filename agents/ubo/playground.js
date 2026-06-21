"use strict";

// Local, no-credential interactive harness for the standalone UBO framework.
// It deliberately accepts user-entered evidence rather than pretending to
// search live registries. Production adapters plug into the same orchestrator.
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { runUboFramework } = require("./uboOrchestrator");

const TYPES = ["individual", "company", "trust", "foundation", "government", "public_company", "unknown"];

async function askOwnershipStatements(rl, rootEntity) {
  const statements = [];
  console.log("\nAdd ownership links one at a time. Leave the owner name blank when finished.");
  console.log(`For example: owner 'Parent Ltd', type 'company', 80, owned entity '${rootEntity.name}'.`);
  console.log("Then add: owner 'Jane Doe', type 'individual', 60, owned entity 'Parent Ltd'.\n");
  while (true) {
    const ownerName = (await rl.question("Owner name (blank to finish): ")).trim();
    if (!ownerName) break;
    const typeInput = (await rl.question(`Owner type [${TYPES.join(", ")}] (company): `)).trim().toLowerCase();
    const type = TYPES.includes(typeInput) ? typeInput : (typeInput ? "unknown" : "company");
    const percentage = Number((await rl.question("Ownership percentage: ")).trim());
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      console.log("Please enter a number from 0 to 100. That link was skipped.\n");
      continue;
    }
    const ownedName = (await rl.question(`Entity owned (blank = ${rootEntity.name}): `)).trim() || rootEntity.name;
    const ownerJurisdiction = (await rl.question(`Owner jurisdiction (${rootEntity.jurisdiction}): `)).trim().toUpperCase() || rootEntity.jurisdiction;
    statements.push({
      id: `entered-${statements.length + 1}`,
      owner: { name: ownerName, type, jurisdiction: ownerJurisdiction },
      ownedEntity: { name: ownedName, type: ownedName === rootEntity.name ? "company" : "company", jurisdiction: rootEntity.jurisdiction },
      ownershipPercentage: percentage,
      evidenceIds: [`user-entered-${statements.length + 1}`],
      confidence: 100,
    });
    console.log("Link added.\n");
  }
  return statements;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("\nUBO Discovery Framework — local playground\n");
    const entityName = (await rl.question("Customer company name: ")).trim();
    const jurisdiction = (await rl.question("Customer company jurisdiction (e.g. GB): ")).trim().toUpperCase();
    if (!entityName || !jurisdiction) throw new Error("A company name and jurisdiction are required.");
    const registrationNumber = (await rl.question("Registration number (optional): ")).trim() || null;
    const thresholdText = (await rl.question("UBO threshold % (25): ")).trim();
    const normalisedThreshold = thresholdText.endsWith("%") ? thresholdText.slice(0, -1).trim() : thresholdText;
    const uboThreshold = normalisedThreshold ? Number(normalisedThreshold) : 25;
    if (!Number.isFinite(uboThreshold) || uboThreshold <= 0 || uboThreshold > 100) {
      throw new Error("UBO threshold must be a number from 0 to 100 (for example 25 or 25%).");
    }
    const rootEntity = { name: entityName, jurisdiction, registrationNumber };
    const statements = await askOwnershipStatements(rl, rootEntity);
    const result = await runUboFramework({
      entityName, jurisdiction, registrationNumber,
      tenantConfig: { uboRules: { uboThreshold } },
      adapters: {
        enteredData: async ({ entity }) => ({
          statements: statements.filter((statement) => statement.ownedEntity.name === entity.name),
          evidence: statements
            .filter((statement) => statement.ownedEntity.name === entity.name)
            .map((statement) => ({ id: statement.evidenceIds[0], source: "User-entered playground data", sourceReliability: 100, extractionConfidence: 100, jurisdictionRelevant: true })),
        }),
      },
    });
    console.log("\n--- Result ---");
    console.log(JSON.stringify({
      status: result.status,
      threshold: uboThreshold,
      ubos: result.ubos,
      ownershipGraph: result.ownershipGraph,
      explanations: result.explanations,
      missingInformation: result.missingInformation,
      budget: result.budget,
    }, null, 2));
  } finally {
    rl.close();
  }
}

main().catch((error) => { console.error(`\nCould not run playground: ${error.message}`); process.exitCode = 1; });
