"use strict";

/**
 * Which migrations a database gets (UBO-19).
 *
 * The KYC database gets every file in db/migrations. The UBO demo's database
 * gets UBO's tables and Evidence's, which UBO's refer to - and never KYC's.
 * A new UBO or Evidence migration must be added here, or it never reaches the
 * demo: db/__tests__/migrationSets.nodetest.js fails until it is.
 */
const SETS = Object.freeze({
  ubo: Object.freeze([
    "001_tenants.sql",
    "009_ubo_investigations.sql",
    "010_evidence_platform_a1.sql",
    "011_evidence_platform_a2.sql",
    "012_evidence_platform_a3.sql",
    "013_evidence_fact_artifact_support.sql",
    "014_evidence_need_evaluations.sql",
    "015_evidence_interpretation_operations.sql",
    "016_evidence_fact_artifact_locators.sql",
    "017_evidence_typed_relationships.sql",
    "018_evidence_coverage_assessments.sql",
    "019_evidence_packages.sql",
    "020_evidence_customer_extraction_jobs.sql",
    "021_ubo_poc_case_state.sql",
    "029_ubo_audit_events.sql",
  ]),
});

/** The files one set applies (all of them when no set is named). */
function filesFor(set, files) {
  if (!set) return files;
  const names = SETS[set];
  if (!names) throw new Error(`Unknown migration set "${set}". Known: ${Object.keys(SETS).join(", ")}`);
  const missing = names.filter((name) => !files[name]);
  if (missing.length) throw new Error(`The ${set} set names files that are not in db/migrations: ${missing.join(", ")}`);
  return Object.fromEntries([...names].sort().map((name) => [name, files[name]]));
}

/** The set a database has only ever been given, if any: running every file
 *  against a UBO database would put KYC's tables into it. */
function looksLikeSet(applied) {
  if (!applied.length) return null;
  return Object.keys(SETS).find((set) => applied.every((name) => SETS[set].includes(name))) || null;
}

module.exports = { SETS, filesFor, looksLikeSet };
