"use strict";
/*
 * DIAGNOSTIC: isolate why the live-flow screening call throws while screening-live
 * worked. Sends the EXACT subject resolve builds (name + dob + nationality) plus
 * variants, so we can see which field ComplyCube rejects.
 *
 * Run: node -r dotenv/config scripts/demo/screening-debug.js dotenv_config_path=.env.local
 */
const { getScreeningProvider } = require("../../api/idv-match/screening/registry");

async function tryOne(label, subject) {
  process.stdout.write(`\n[${label}] ${JSON.stringify(subject)}\n`);
  try {
    const out = await getScreeningProvider().screenPerson(subject);
    console.log("  OK -> outcome:", out.result ? out.result.outcome : "(pending, no sync result)", "| checkId:", out.providerCheckId);
  } catch (e) {
    console.log("  THREW ->", (e && (e.message || String(e))) || "unknown error");
  }
}

(async () => {
  await tryOne("full (exactly what resolve sends)", { firstName: "Jan", lastName: "Kowalski", dob: "1990-06-15", nationality: "POL" });
  await tryOne("no nationality", { firstName: "Jan", lastName: "Kowalski", dob: "1990-06-15" });
  await tryOne("iso2 nationality (PL)", { firstName: "Jan", lastName: "Kowalski", dob: "1990-06-15", nationality: "PL" });
  await tryOne("name only", { firstName: "Jan", lastName: "Kowalski" });
})().catch((e) => { console.error("\nFATAL:", e && e.message); process.exit(1); });
