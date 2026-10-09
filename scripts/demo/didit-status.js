"use strict";
/*
 * DIAGNOSTIC: print the latest IDV attempt's Didit session status, live.
 * Answers "why does the app say 'Not complete yet'?" - it prints the raw Didit
 * decision status and whether our app treats it as terminal (so it will proceed).
 *
 * Run (in E:\kyc-agent-dev, PowerShell):
 *   node -r dotenv/config scripts/demo/didit-status.js dotenv_config_path=.env.local
 * Or for a specific session id:
 *   node -r dotenv/config scripts/demo/didit-status.js <session_id> dotenv_config_path=.env.local
 */
const { neon } = require("@neondatabase/serverless");
const { getDecision } = require("../../lib/didit/diditClient");

// Mirrors idv/providers/normalization.js#mapProviderStatus + TERMINAL_STATUSES.
const TERMINAL_RAW = ["APPROVED", "SUCCESS", "DECLINED", "FAIL", "FAILED", "ABANDONED", "EXPIRED", "KYC_EXPIRED"];
const norm = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/[\s-]+/g, "_");

(async () => {
  const conn = process.env.IDV_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("IDV_DATABASE_URL not set - run with: -r dotenv/config ... dotenv_config_path=.env.local");
  const sql = neon(conn);

  const argSession = process.argv.slice(2).find((a) => !a.startsWith("dotenv_config_path"));
  let sessionId = argSession;

  if (!sessionId) {
    const rows = await sql`SELECT id, application_id, didit_session_id, status, created_at
                           FROM idv_verification_attempts ORDER BY created_at DESC LIMIT 1`;
    const a = rows[0];
    if (!a) throw new Error("No idv_verification_attempts rows - start a verification in the app first.");
    console.log(`Latest attempt : ${a.id}  (app=${a.application_id}, db_status=${a.status})`);
    sessionId = a.didit_session_id;
  }
  if (!sessionId) throw new Error("Attempt has no didit_session_id.");
  console.log(`Didit session  : ${sessionId}\n`);

  const decision = await getDecision(sessionId);
  const raw = decision && (decision.status || (decision.session && decision.session.status));
  const terminal = TERMINAL_RAW.includes(norm(raw));

  console.log(`Didit status   : ${raw}`);
  console.log(`App proceeds?  : ${terminal ? "YES - this is terminal, the flow will continue" : "NO - app shows 'Not complete yet' until Didit reaches Approved/Declined/Abandoned/Expired"}`);

  // The flow needs a usable NAME (first+last, or an MRZ) to match an officer and to
  // screen. If Didit extracted no name, resolve returns "missing_required_data".
  const v = (decision && (decision.id_verifications || decision.id_verification) || [])[0] || {};
  const nameFields = {
    first_name: v.first_name, last_name: v.last_name, full_name: v.full_name,
    date_of_birth: v.date_of_birth, nationality: v.nationality,
    document_type: v.document_type, mrz: v.mrz ? "(present)" : v.mrz,
  };
  const nameUsable = !!((v.first_name && v.last_name) || v.mrz);
  console.log(`\nExtracted name : ${JSON.stringify(nameFields)}`);
  console.log(`Name usable?   : ${nameUsable ? "YES" : "NO - no first+last and no MRZ -> resolve returns 'missing_required_data' (this is the stuck cause)"}`);

  console.log(`\nDecision keys  : ${Object.keys(decision || {}).join(", ")}`);
  console.log("\n--- full decision (synthetic sandbox data) ---");
  console.log(JSON.stringify(decision, null, 2).slice(0, 4000));
})().catch((e) => {
  console.error("\nFAILED:", e && e.message);
  process.exit(1);
});
