/**
 * policyTable.js — the decision table as DATA, not logic.
 *
 * An ordered array of rules. Each rule is { id, when, then }:
 *   when: a PARTIAL match pattern. Any enum field omitted from `when` is a
 *         wildcard. A rule matches when every key present in `when` equals the
 *         corresponding engine input.
 *   then: the (partial) outcome spliced over the engine's default result.
 *
 * FIRST MATCHING RULE WINS. Jurisdiction overrides (policyTable.jurisdictions.js)
 * are spliced AHEAD of these base rows by classifyChange.
 *
 * This table encodes ONLY the combinations actually decided in the design
 * discussion. Everything else is intentionally absent so the completeness sweep
 * flags it as UNDECIDED rather than letting a silent default paper over it.
 *
 * Notes:
 * - PEP and the verifiability guard are HARD RULES in classifyChange that run
 *   BEFORE this table — they are deliberately not rows here.
 * - No row sets eddFlag. EDD triggering conditions were never specified
 *   (open question O2) — every EDD path is UNDECIDED and must NOT be defaulted.
 *   The 'edd' workflow value is therefore currently unreachable, by design.
 */

const BASE_RULES = [
  // ── Director (structured_registry only; the guard handles other sources) ──
  {
    id: 'DIR-ADD-GENUINE-NOTREFLECTED',
    when: { fieldClass: 'director', changeType: 'add', intent: 'genuine_update', registryStatus: 'not_reflected' },
    then: { workflow: 'doc_required', docType: 'Updated Director Registry' },
  },
  {
    id: 'DIR-ADD-GENUINE-REFLECTED',
    when: { fieldClass: 'director', changeType: 'add', intent: 'genuine_update', registryStatus: 'reflected' },
    then: { workflow: 'ops_review' },
  },
  {
    // name/dob correction — the AI read an existing director wrong. Any registry.
    id: 'DIR-CORRECT',
    when: { fieldClass: 'director', changeType: 'correct', intent: 'ai_correction' },
    then: { workflow: 'ops_review' },
  },
  {
    id: 'DIR-REMOVE-GENUINE-NOTREFLECTED',
    when: { fieldClass: 'director', changeType: 'remove', intent: 'genuine_update', registryStatus: 'not_reflected' },
    then: { workflow: 'doc_required', docType: 'Updated Director Registry' },
  },
  {
    id: 'DIR-REMOVE-GENUINE-REFLECTED',
    when: { fieldClass: 'director', changeType: 'remove', intent: 'genuine_update', registryStatus: 'reflected' },
    then: { workflow: 'ops_review' },
  },

  // ── UBO (structured_registry only) ──
  {
    id: 'UBO-ADD-GENUINE-NOTREFLECTED',
    when: { fieldClass: 'ubo', changeType: 'add', intent: 'genuine_update', registryStatus: 'not_reflected' },
    then: { workflow: 'doc_required', docType: 'Updated UBO Registry' },
  },
  {
    id: 'UBO-ADD-GENUINE-REFLECTED',
    when: { fieldClass: 'ubo', changeType: 'add', intent: 'genuine_update', registryStatus: 'reflected' },
    then: { workflow: 'ops_review' },
  },
  {
    id: 'UBO-CORRECT',
    when: { fieldClass: 'ubo', changeType: 'correct', intent: 'ai_correction' },
    then: { workflow: 'ops_review' },
  },
  {
    // shareholding genuinely changed and the registry doesn't yet reflect it.
    id: 'UBO-SHAREHOLDING-UPDATE-NOTREFLECTED',
    when: { fieldClass: 'ubo', changeType: 'update', intent: 'genuine_update', registryStatus: 'not_reflected' },
    then: { workflow: 'doc_required', docType: 'Updated UBO Registry' },
  },

  // ── Address (structured_registry only; no intent dependency) ──
  {
    id: 'ADDR-REFLECTED',
    when: { fieldClass: 'address', registryStatus: 'reflected' },
    then: { workflow: 'ops_review' },
  },
  {
    id: 'ADDR-NOTREFLECTED',
    when: { fieldClass: 'address', registryStatus: 'not_reflected' },
    then: { workflow: 'doc_required', docType: 'Notice of Change of Address' },
  },

  // ── Factual ID — BRN / VAT / Licence Number. No dialogue, no intent needed. ──
  // docType is a single placeholder pending per-field mapping (open question O3).
  {
    id: 'FACTUALID-CORRECT',
    when: { fieldClass: 'factualId', changeType: 'correct' },
    then: { workflow: 'doc_required', docType: 'Supporting Registration Document' },
  },
  {
    id: 'FACTUALID-UPDATE',
    when: { fieldClass: 'factualId', changeType: 'update' },
    then: { workflow: 'doc_required', docType: 'Supporting Registration Document' },
  },

  // ── Generic ops-review fields — annualRevenue, employees, website, etc. ──
  // Any change, any intent: ops review, no doc, silent to the customer.
  {
    id: 'GENERIC',
    when: { fieldClass: 'generic' },
    then: { workflow: 'ops_review', silent: true },
  },

  // ── Structural — classification-only in this slice. ──
  // 'different_entity' = a different company entirely → identity-invalidating → restart.
  {
    id: 'STRUCT-DIFFERENT-ENTITY',
    when: { fieldClass: 'structural', intent: 'different_entity' },
    then: { workflow: 'restart' },
  },
  // 'ai_correction' = same company, wrong classification → interpretation-
  // invalidating → re_derive. The engine only HINTS that the doc set may change
  // (docSetMayChange) — it does NOT compute the doc itself; the DRS resolves it.
  {
    id: 'STRUCT-REDERIVE',
    when: { fieldClass: 'structural', intent: 'ai_correction' },
    then: { workflow: 're_derive', docSetMayChange: true },
  },
];

module.exports = { BASE_RULES };
