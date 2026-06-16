/**
 * test-self-source.js
 * Integration test for selfSourceAgent + selfSourceFieldMapper + selfSourceOrchestrator.
 *
 * Runs two scenarios:
 *   1. UK / Privately owned / Corporate  → Companies House (Preferred self-source)
 *      Expected: Legal existence + Constitution retrieved, fields mapped to dossier
 *
 *   2. Brazil / Privately owned / Corporate  → Receita Federal (needs CNPJ for second pass)
 *      Expected: first pass low confidence → second pass attempted with CNPJ
 *
 * Usage (from project root):
 *   node test-self-source.js
 *
 * Requires:
 *   - agents/selfSourceAgent.js
 *   - agents/selfSourceFieldMapper.js
 *   - agents/selfSourceOrchestrator.js
 *   - agents/docSearchAgent.js
 *   - documentRequirements.js (repo root)
 *   - ANTHROPIC_API_KEY in env
 */

const path = require("path");

// ── Resolve paths relative to project root ────────────────────────────────────
// Adjust these paths to match your project structure:
//   agents/ folder = where you placed the three agent files
//   documentRequirements.js = repo root
const AGENTS_DIR = path.resolve(__dirname, "agents");
const DRS_PATH   = path.resolve(__dirname, "documentRequirements.js");
const OUT_DIR    = path.resolve(__dirname, "test-output-self-source");

const { selfSourceAgent }         = require(path.join(AGENTS_DIR, "selfSourceAgent.js"));
const { mapSelfSourcedFields, getManualReviewItems } = require(path.join(AGENTS_DIR, "selfSourceFieldMapper.js"));
const { orchestrateDocuments }    = require(path.join(AGENTS_DIR, "selfSourceOrchestrator.js"));
const { getRequirements, deriveOnboardingCountry } = require(DRS_PATH);

const fs = require("fs");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function printSection(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function printResult(label, value) {
  const display = typeof value === "object" ? JSON.stringify(value, null, 2) : value;
  console.log(`\n[${label}]\n${display}`);
}

// ─── Scenario 1: UK Privately Owned Corporate ─────────────────────────────────
async function testUkCorporate() {
  printSection("SCENARIO 1 — UK / Privately owned / Corporate");

  const companyName            = "Revolut Ltd";
  const incorporationCountry   = "United Kingdom";
  const companyRegistrationNumber = "08804411"; // real Companies House number

  const checklist = getRequirements({
    incorporationCountry,
    entityType:    "Privately owned",
    ownershipType: "Privately owned",
    sector:        "Other (General / non-regulated / commercial businesses)",
  });

  const selfSourceItems = checklist.filter(i =>
    ["Preferred self-source", "Supplementary self-source"].includes(i.selfSource)
  );

  console.log(`\nDRS checklist: ${checklist.length} items total`);
  console.log(`Self-sourceable: ${selfSourceItems.length}`);
  selfSourceItems.forEach(i => console.log(`  • ${i.requirement} (${i.selfSource})`));

  const result = await selfSourceAgent({
    companyName,
    incorporationCountry,
    drsChecklist:             checklist,
    companyRegistrationNumber,
    outputDir:                `${OUT_DIR}/uk-corporate`,
  });

  printResult("Summary", result.summary);

  const mapped = mapSelfSourcedFields(result.results);
  const manual = getManualReviewItems(result.results);

  console.log(`\n[Mapped fields → dossier] ${Object.keys(mapped).length} fields`);
  Object.entries(mapped).forEach(([fieldId, field]) => {
    console.log(`  ${fieldId.padEnd(30)} = "${field.value}" (${field.tier}, ${field.confidence}, source: ${field.sourceLabel})`);
  });

  if (manual.length > 0) {
    console.log(`\n[Manual review required] ${manual.length} items`);
    manual.forEach(m => console.log(`  ⚠ ${m.requirement}: ${m.manualReviewReason}`));
  }

  console.log(`\n[Cost] $${result.cost.totals.totalCostUSD.toFixed(5)}`);
  console.log(`[Output dir] ${result.outputDir}`);

  return result;
}

// ─── Scenario 2: Brazil Corporate (second-pass test) ──────────────────────────
async function testBrazilCorporate() {
  printSection("SCENARIO 2 — Brazil / Privately owned / Corporate (second-pass test)");

  const companyName              = "Nubank S.A.";
  const incorporationCountry     = "Brazil";
  // CNPJ — without this, first pass will fail and second pass is skipped
  const companyRegistrationNumber = "18.236.120/0001-58";

  const checklist = getRequirements({
    incorporationCountry,
    entityType:    "Privately owned",
    ownershipType: "Privately owned",
    sector:        "Other (General / non-regulated / commercial businesses)",
  });

  const selfSourceItems = checklist.filter(i =>
    ["Preferred self-source", "Supplementary self-source"].includes(i.selfSource)
  );

  console.log(`\nDRS checklist: ${checklist.length} items total`);
  console.log(`Self-sourceable: ${selfSourceItems.length}`);
  selfSourceItems.forEach(i => console.log(`  • ${i.requirement} (${i.selfSource})`));

  const result = await selfSourceAgent({
    companyName,
    incorporationCountry,
    drsChecklist:             checklist,
    companyRegistrationNumber,
    outputDir:                `${OUT_DIR}/brazil-corporate`,
  });

  printResult("Summary", result.summary);

  result.results.forEach(r => {
    console.log(`\n  ${r.requirement}:`);
    console.log(`    status:       ${r.status}`);
    console.log(`    pass1 url:    ${r.searchUrl}`);
    console.log(`    pass2 url:    ${r.secondPassUrl || "not attempted"}`);
    console.log(`    confidence:   ${r.extracted?.matchConfidence ?? "—"}`);
    console.log(`    manualFlag:   ${r.manualReviewFlag ?? false}`);
  });

  const mapped = mapSelfSourcedFields(result.results);
  console.log(`\n[Mapped fields] ${Object.keys(mapped).length} fields`);

  console.log(`\n[Cost] $${result.cost.totals.totalCostUSD.toFixed(5)}`);
  return result;
}

// ─── Scenario 3: Full orchestrator (UK FI — both agents) ──────────────────────
async function testFullOrchestrator() {
  printSection("SCENARIO 3 — Full orchestrator: UK FI (Wolfsberg + Annual Report + Registry)");

  const companyName            = "Barclays PLC";
  const incorporationCountry   = "United Kingdom";
  const companyRegistrationNumber = "01026167";

  const checklist = getRequirements({
    incorporationCountry,
    entityType:    "Financial Institution",
    ownershipType: "Publicly listed",
    sector:        "Financial Institution - bank / credit institution",
  });

  const result = await orchestrateDocuments({
    companyName,
    incorporationCountry,
    ownershipType:            "public_fi",
    niumEntityType:           "fi",
    drsChecklist:             checklist,
    companyRegistrationNumber,
    outputDir:                `${OUT_DIR}/barclays-fi`,
  });

  printResult("Orchestrator summary", result.summary);

  console.log(`\n[selfSourcedFields → dossier] ${Object.keys(result.selfSourcedFields).length} fields ready for pre-population:`);
  Object.entries(result.selfSourcedFields).forEach(([fieldId, field]) => {
    console.log(`  ${fieldId.padEnd(30)} = "${field.value}" [${field.tier} | ${field.sourceLabel}]`);
  });

  if (result.manualReviewItems.length > 0) {
    console.log(`\n[Manual review needed]`);
    result.manualReviewItems.forEach(m => console.log(`  ⚠ ${m.requirement}`));
  }

  if (result.duplicateFlags.length > 0) {
    console.log(`\n[Duplicate flags]`);
    result.duplicateFlags.forEach(f => console.log(`  📋 ${f.drsRequirement} ↔ ${f.webDocType}: ${f.recommendation}`));
  }

  console.log(`\n[Total cost] $${result.cost.combined.totalCostUSD.toFixed(5)}`);
  console.log(`[Output dir] ${result.outputDir}`);

  // Write merged table to JSON for inspection
  const tableOut = path.join(OUT_DIR, "barclays_merged_table.json");
  fs.writeFileSync(tableOut, JSON.stringify(result.mergedTable, null, 2));
  console.log(`[Merged table] → ${tableOut}`);

  return result;
}

// ─── Run all scenarios ────────────────────────────────────────────────────────
async function main() {
  console.log("\n🧪 selfSourceAgent integration tests");
  console.log(`📁 Output directory: ${OUT_DIR}`);
  console.log(`🔑 API key: ${process.env.ANTHROPIC_API_KEY ? "present" : "MISSING — set ANTHROPIC_API_KEY"}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY not set. Exiting.");
    process.exit(1);
  }

  const scenario = process.argv[2]; // e.g. node test-self-source.js 1

  try {
    if (!scenario || scenario === "1") await testUkCorporate();
    if (!scenario || scenario === "2") await testBrazilCorporate();
    if (!scenario || scenario === "3") await testFullOrchestrator();

    console.log("\n✅ All tests complete. Check output in:", OUT_DIR);
  } catch (err) {
    console.error("\n❌ Test failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
