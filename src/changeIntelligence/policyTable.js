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

/**
 * ── PERSON RULES (CD-03, ratified 26 Jul 2026) ──────────────────────────────
 *
 * Same table format, same matcher, same result shape as BASE_RULES — these are
 * ADDED rules, not a parallel engine. They apply only to person-scoped changes
 * (classifyChange's `personScope: true` path); company-level classification is
 * completely unaffected.
 *
 * THE LOAD-BEARING RULE: documents are keyed off PERSON TYPE, not the attribute
 * corrected. The same attribute correction produces a document for a UBO and no
 * document for a director-only person, because a director's identity is already
 * registry-verified (Companies House / ACRA) — collecting POI/POA from them
 * would over-collect against the UK/SG standard.
 *
 * `then.silent: true` means the change is accepted and recorded with nothing
 * shown to the customer.
 *
 * Two sub-rules are deliberately UNDECIDED because they need real ownership
 * data that the person-type stub cannot honestly supply (see personType.js):
 * the ≥25%→<25% threshold crossing, and the pseudo-UBO case. UNDECIDED is
 * inert — recorded, no customer-facing consequence — never a guess.
 */
const PERSON_RULES = [
  // Pseudo-UBO (most-senior-director-as-UBO where nobody meets the threshold)
  // is not derivable without real ownership data. FIRST so it wins for every
  // attribute. Nothing currently produces this personType.
  {
    id: 'PERSON-PSEUDO-UBO-UNDECIDED',
    when: { personScope: true, personType: 'pseudo_ubo' },
    then: { workflow: 'UNDECIDED', decided: false, silent: true },
  },

  // ── Name: the three-way question (never a plain text edit) ──
  {
    // "You spelled this person's name wrong" — AI error, same person.
    id: 'PERSON-NAME-TYPO',
    when: { personScope: true, attribute: 'name', nameCase: 'typo' },
    then: { workflow: 'accept_silent', silent: true },
  },
  {
    // "Their name legally changed" — same person, new name. POI shows the
    // CURRENT name; we never ask for a name-change certificate, and we do not
    // care about the former name. The list document is emitted as its own
    // event (attribute 'name_list') so both are requested.
    id: 'PERSON-NAME-LEGAL-UBO',
    when: { personScope: true, attribute: 'name', nameCase: 'legal_change', personType: 'ubo' },
    then: { workflow: 'doc_required', docType: 'Proof of Identity' },
  },
  {
    // Director-only: no POI (registry-verified identity), list document only.
    id: 'PERSON-NAME-LEGAL-DIRECTOR',
    when: { personScope: true, attribute: 'name', nameCase: 'legal_change', personType: 'director' },
    then: { workflow: 'doc_required', docType: 'List of Directors' },
  },
  // The companion list document for a UBO legal name change.
  {
    id: 'PERSON-NAME-LIST-UBO',
    when: { personScope: true, attribute: 'name_list', personType: 'ubo' },
    then: { workflow: 'doc_required', docType: 'Ownership Chart' },
  },
  {
    id: 'PERSON-NAME-LIST-DIRECTOR',
    when: { personScope: true, attribute: 'name_list', personType: 'director' },
    then: { workflow: 'doc_required', docType: 'List of Directors' },
  },

  // ── Date of birth ──
  {
    id: 'PERSON-DOB-UBO',
    when: { personScope: true, attribute: 'dob', personType: 'ubo' },
    then: { workflow: 'doc_required', docType: 'Proof of Identity' },
  },
  {
    id: 'PERSON-DOB-DIRECTOR',
    when: { personScope: true, attribute: 'dob', personType: 'director' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── Nationality (EDD flag on high-risk is applied post-match, either way) ──
  {
    id: 'PERSON-NATIONALITY-UBO',
    when: { personScope: true, attribute: 'nationality', personType: 'ubo' },
    then: { workflow: 'doc_required', docType: 'Proof of Identity' },
  },
  {
    id: 'PERSON-NATIONALITY-DIRECTOR',
    when: { personScope: true, attribute: 'nationality', personType: 'director' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── Country of birth: never its own document (POI carries it). Separate
  //    compliance signal from nationality — it does NOT fold into it. ──
  {
    id: 'PERSON-COUNTRY-OF-BIRTH',
    when: { personScope: true, attribute: 'country_of_birth' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── Residential address ──
  {
    id: 'PERSON-ADDRESS-UBO',
    when: { personScope: true, attribute: 'residential_address', personType: 'ubo' },
    then: { workflow: 'doc_required', docType: 'Proof of Address' },
  },
  {
    id: 'PERSON-ADDRESS-DIRECTOR',
    when: { personScope: true, attribute: 'residential_address', personType: 'director' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── PEP: add-only (research never returns it). Person-scoped, so it does NOT
  //    disturb the company-level PEP hard rule in classifyChange. ──
  {
    id: 'PERSON-PEP-YES',
    when: { personScope: true, attribute: 'pep', pepValue: 'yes' },
    then: { workflow: 'doc_required', docType: 'Source of Wealth', eddFlag: true },
  },
  {
    id: 'PERSON-PEP-NO',
    when: { personScope: true, attribute: 'pep', pepValue: 'no' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── Ownership %: the change is accepted; only a ≥25%→<25% crossing flags an
  //    analyst. Crossing cannot be computed from stub data, so 'unknown' — the
  //    only value produced today — records UNDECIDED rather than guessing. ──
  {
    id: 'PERSON-OWNERSHIP-CROSSING-UNKNOWN',
    when: { personScope: true, attribute: 'ownership_pct', thresholdCrossing: 'unknown' },
    then: { workflow: 'UNDECIDED', decided: false, silent: true },
  },
  {
    id: 'PERSON-OWNERSHIP-CROSSED-BELOW',
    when: { personScope: true, attribute: 'ownership_pct', thresholdCrossing: 'crossed_below' },
    then: { workflow: 'analyst_review', silent: true },
  },
  {
    id: 'PERSON-OWNERSHIP-NO-CROSSING',
    when: { personScope: true, attribute: 'ownership_pct', thresholdCrossing: 'none' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── Role/title change that is not a removal (e.g. director → secretary). ──
  {
    id: 'PERSON-ROLE-CHANGE',
    when: { personScope: true, attribute: 'role' },
    then: { workflow: 'accept_silent', silent: true },
  },

  // ── Removal. The list document IS the analyst trigger — requesting it means
  //    an analyst reviews the removal, so there is no separate analyst flag. ──
  {
    id: 'PERSON-REMOVAL-DIRECTOR',
    when: { personScope: true, attribute: 'removal', personType: 'director' },
    then: { workflow: 'doc_required', docType: 'List of Directors' },
  },
  {
    id: 'PERSON-REMOVAL-UBO',
    when: { personScope: true, attribute: 'removal', personType: 'ubo' },
    then: { workflow: 'doc_required', docType: 'Ownership Chart' },
  },
];

module.exports = { BASE_RULES, PERSON_RULES };
