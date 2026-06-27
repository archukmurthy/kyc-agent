// Seeds a richer Change-Intelligence scenario under unique submission ids, runs
// the real metrics route handler against Neon, prints the headline + meta, then
// deletes ONLY the seeded rows (genuine captured data is left untouched).
// Run: node test-dashboard-seed.js
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const { writeEvent } = require("./src/changeIntelligence/events/writeEvent");
const metricsHandler = require("./api/change-intelligence-metrics.js");

const SUB1 = `dash-demo-1-${Date.now()}`;
const SUB2 = `dash-demo-2-${Date.now()}`;

function mockRes() { return { body: null, status() { return this; }, json(d) { this.body = d; return this; } }; }

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const base = { changeType: "changed", jurisdiction: "GB" };

  // SUB1 — a spread of outcomes
  await writeEvent(sql, { ...base, submissionId: SUB1, fieldId: "director.0.name", fieldClass: "director", workflow: "doc_required", customerIntent: "ai_correction", sourceProvider: "Companies House" });
  await writeEvent(sql, { ...base, submissionId: SUB1, fieldId: "address.reg", fieldClass: "address", workflow: "ops_review", customerIntent: "genuine_update" });
  await writeEvent(sql, { ...base, submissionId: SUB1, fieldId: "pep.status", fieldClass: "pep", workflow: "escalation", escalation: true, escalationReason: "PEP review" });
  await writeEvent(sql, { ...base, submissionId: SUB1, fieldId: "ubo.0.name", fieldClass: "ubo", workflow: "UNDECIDED", decided: false, customerIntent: "ai_correction" });

  // SUB2 — a correction that is REVERTED (superseded), plus a failure fallback
  const e5 = await writeEvent(sql, { ...base, submissionId: SUB2, fieldId: "director.0.name", fieldClass: "director", workflow: "doc_required", customerIntent: "ai_correction" });
  await writeEvent(sql, { ...base, submissionId: SUB2, fieldId: "director.0.name", fieldClass: "director", workflow: "ops_review", customerIntent: "genuine_update", supersedesId: e5.id });
  await writeEvent(sql, { ...base, submissionId: SUB2, fieldId: "reresearch.fallback", fieldClass: "structural", workflow: "ops_review", matchedRule: "RERESEARCH-FALLBACK-MANUAL", afterValue: { fellBackTo: "manual", stage: "re_research", reason: "registry_timeout" } });

  // Run the REAL metrics route
  const res = mockRes();
  await metricsHandler({ method: "GET" }, res);
  const m = res.body;

  console.log("=== META ===");
  console.log(JSON.stringify(m.meta));
  console.log("=== HEADLINE STRIP (as rendered) ===");
  const h = m.headline;
  console.log(`Corrections captured : ${h.correctionsCaptured.value}   (based on ${h.correctionsCaptured.sampleSize} onboardings)`);
  console.log(`AI-error corrections : ${h.aiErrorCorrections.value}   (based on ${h.aiErrorCorrections.sampleSize} onboardings)`);
  console.log(`Back-and-forth pre-empted : ${h.rfiPreempted.value}   (based on ${h.rfiPreempted.sampleSize} onboardings)`);
  console.log(`Escalations flagged : ${h.escalationsFlagged.value}   (based on ${h.escalationsFlagged.sampleSize} onboardings)`);
  console.log("early-data note showing?", m.meta.earlyData, `(onboardings ${m.meta.onboardings} < threshold ${m.meta.earlyDataThreshold})`);
  console.log("any % accuracy rate in headline?", JSON.stringify(h).match(/percent|rate|accuracy/i) ? "YES" : "NO — counts only");
  console.log("=== DETAIL spot-check ===");
  console.log("intent split overall:", JSON.stringify(m.detail.intentSplit.overall));
  console.log("undecided:", JSON.stringify(m.detail.undecided));
  console.log("failure fallbacks:", m.detail.failureFallbacks.length, m.detail.failureFallbacks[0] ? JSON.stringify(m.detail.failureFallbacks[0]) : "");
  console.log("byField top:", m.detail.byField.slice(0, 4).map((f) => `${f.fieldId}=${f.count}`).join(", "));

  // cleanup ONLY seeded rows
  const del = await sql`DELETE FROM change_events WHERE submission_id IN (${SUB1}, ${SUB2}) RETURNING id`;
  console.log(`\ncleaned up ${del.length} seeded rows (genuine data untouched)`);
  process.exit(0);
})().catch((e) => { console.error("seed/verify failed:", e.message); process.exit(1); });
