// Smoke test: change-events write route + amendment-documents read route against
// REAL Neon, without the dev server (src/setupProxy.js is DO-NOT-TOUCH and does
// not proxy these new routes locally). Writes to a unique throwaway submission id,
// asserts the derived doc list (active in, reverted out, null-docType out), then
// deletes the test rows. Run: node test-change-events.js
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

const writeHandler = require("./api/change-events.js");
const readHandler = require("./api/amendment-documents.js");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
}
async function post(event) {
  const res = mockRes();
  await writeHandler({ method: "POST", body: event }, res);
  return res.body;
}
async function getDocs(submissionId) {
  const res = mockRes();
  await readHandler({ method: "GET", query: { submissionId } }, res);
  return res.body;
}

(async () => {
  const SUB = `test-amend-${Date.now()}`;
  const base = { submissionId: SUB, fieldClass: "director", changeType: "changed", jurisdiction: "GB" };
  console.log("submission:", SUB);

  // 1) active doc_required → expected in the list
  const a = await post({ ...base, fieldId: "director.0.name", workflow: "doc_required", docType: "Updated Director Registry", matchedRule: "DIR-ADD" });
  console.log("write A:", a);

  // 2) doc_required then revert (supersede with a non-doc event) → drops off
  const b1 = await post({ ...base, fieldId: "address.reg", fieldClass: "address", workflow: "doc_required", docType: "Proof of Address" });
  const b2 = await post({ ...base, fieldId: "address.reg", fieldClass: "address", workflow: "ops_review", supersedesId: b1.id });
  console.log("write B1/B2:", b1, b2);

  // 3) null docType doc_required → excluded (never invent a docType)
  const c = await post({ ...base, fieldId: "pep.status", fieldClass: "pep", workflow: "doc_required", docType: null, decided: false });
  console.log("write C:", c);

  const docs = await getDocs(SUB);
  console.log("\nderived documents:", JSON.stringify(docs, null, 2));

  const ids = (docs.documents || []).map((d) => `${d.fieldId}:${d.docType}`).sort();
  const expected = ["director.0.name:Updated Director Registry"];
  const ok = JSON.stringify(ids) === JSON.stringify(expected);
  console.log("\nEXPECTED:", expected);
  console.log("GOT     :", ids);
  console.log(ok ? "✅ ROUND-TRIP CORRECT (active in, reverted out, null-docType out)" : "❌ MISMATCH");

  // operator cleanup of this verification run's rows
  const sql = neon(process.env.DATABASE_URL);
  const del = await sql`DELETE FROM change_events WHERE submission_id = ${SUB} RETURNING id`;
  console.log(`cleaned up ${del.length} test rows`);

  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("verify failed:", e); process.exit(1); });
