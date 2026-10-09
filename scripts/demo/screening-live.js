"use strict";
/*
 * DEMO: prove screening is a REAL ComplyCube call, not a local fixture.
 *
 * Makes one live call to ComplyCube's SANDBOX (free; uses the test_ key in
 * .env.local) for a person whose last name is "attention" - ComplyCube's sandbox
 * returns an "attention" (hit) outcome for that name - then prints the real
 * response interpreted into our signal (outcome + PEP/sanctions/adverse-media).
 *
 * Run (in E:\kyc-agent-dev, PowerShell):
 *   node -r dotenv/config scripts/demo/screening-live.js dotenv_config_path=.env.local
 * Optional: pass a different last name to see a CLEAR result:
 *   node -r dotenv/config scripts/demo/screening-live.js Smith dotenv_config_path=.env.local
 *
 * No database needed - this calls the vendor directly and prints the answer.
 */
const cc = require("../../api/idv-match/screening/complyCubeClient");
const { interpretCheck } = require("../../api/idv-match/screening/interpret");

// argv may include the dotenv_config_path token; take the first arg that isn't it.
const lastName = process.argv.slice(2).find((a) => !a.startsWith("dotenv_config_path")) || "attention";

(async () => {
  const person = { firstName: "Demo", lastName };
  console.log(`\nCalling ComplyCube SANDBOX for: ${person.firstName} ${person.lastName}`);
  console.log('("attention" => sandbox returns a hit; any other name => clear)\n');

  const client = await cc.createClient(person);
  const check = await cc.createScreeningCheck(client.id);

  // The check may complete synchronously or need a moment - poll getCheck until an outcome lands.
  let current = check;
  for (let i = 0; i < 10 && !(current.result && current.result.outcome); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    current = await cc.getCheck(check.id);
  }

  const r = interpretCheck(current);
  console.log("ComplyCube client id : " + client.id);
  console.log("ComplyCube check id  : " + check.id);
  console.log("outcome              : " + r.outcome + "   | HIT: " + r.hit + " | matches: " + r.matchCount);
  console.log("categories           : pep=" + r.categories.pep +
    "  sanctions(watchlist)=" + r.categories.watchlist +
    "  adverse-media=" + r.categories.adverseMedia +
    "  other=" + r.categories.other);
  console.log("band effect          : " + (r.hit
    ? "HARD EXCLUSION -> applicant routed to review (never auto-passes)"
    : "no hit -> proceeds normally"));
  console.log("\nThis result came from ComplyCube's sandbox servers over the network - not a local fixture.\n");
})().catch((e) => {
  console.error("\nFAILED:", e && e.message);
  console.error("(Check COMPLYCUBE_API_KEY is a test_ key and SCREENING_RUNTIME_MODE=test in .env.local.)\n");
  process.exit(1);
});
