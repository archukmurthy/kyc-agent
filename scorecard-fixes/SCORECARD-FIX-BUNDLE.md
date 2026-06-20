# Claude Code — Scorecard Fix Bundle (single pass)

Apply ALL changes below in order, then regenerate the scorecard and recompute
every metric over the existing stored pilot output (no re-running the agent —
all required fields are already present in stored `found` / coverage objects).

Strict header / autonomous mode. On Windows, run `powershell -File alert.ps1`
when done.

## Context / files
- `run.mjs` — the benchmark runner (metricsFor, aggregate, console + HTML).
- The coverage object (`cov`: fillRate, populatedFields, totalResearchFields,
  verifiedFields, probableFields, indicativeFields, customerSuppliedFieldCount)
  is produced elsewhere — locate that module (grep `populatedFields`,
  `totalResearchFields`). Some changes below touch it; find it before editing.
- Schema field definitions (research fields, tiers, searchHints) — locate the
  schema module (grep `searchHint`, `researchFieldCount`).

Do NOT proceed to a change that depends on a file you cannot locate — stop and
report which file is missing instead of guessing.

---

## CHANGE 1 — Schema fields: search hints + customerSupplied flags

Source of truth: `benchmark/fi-schema-fields-patch.js` (already written).
Merge its three groups into the live schema module:

- `researchableFields` (9): vat_number, additional_urls,
  is_business_address_same_as_registered, regulatory_enforcement_action,
  individual_customer_pct, corporate_customer_pct, top_corporate_industries,
  deals_virtual_currencies, accepts_cash — each with its `searchHint`, tier as
  specified.
- `researchableListFields` (2): top_countries_payin, top_countries_payout —
  searchHint says fill country LIST only, leave % split blank
  (`splitIsCustomerSupplied: true`).
- `customerSuppliedFields` (18): all payout/collections %, expected
  credit/debit volume+count+value, top_senders, top_beneficiaries, the two
  country %-split fields, and owner_director_criminal_conviction
  (`doNotAutoResearch: true`). Each carries `customerSupplied: true`.

The coverage computation MUST exclude `customerSupplied: true` fields from
`totalResearchFields` (the researchable denominator) so they don't depress
coverage or pre-fill rate. If it doesn't already, fix it there.

owner_director_criminal_conviction: ensure nothing in the research pass attempts
to auto-fill it. It is self-declaration only.

---

## CHANGE 2 — Metric #1b: Form pre-fill rate (new, alongside coverage)

Add a second coverage figure to `metricsFor()`:

- `onboardingCoverage` (#1, EXISTING, keep) = populatedFields /
  totalResearchFields  → "researchable-field coverage" (rename label to
  "Required-field coverage" in display).
- `formPreFillRate` (#1b, NEW) = populatedFields / totalFieldCount  → fraction
  of the WHOLE form pre-filled before any human input. `totalFieldCount` is on
  the schema/coverage object already.

Aggregate both. In the HTML, show them as a matched pair:
"Required-field coverage" and "Form pre-fill rate". Report pre-fill rate BY
SEGMENT (never pooled — sole traders drag a pooled mean).

---

## CHANGE 3 — Metric #2: Questions avoided at DATA-POINT level

Source of truth: `benchmark/question-weight.mjs` (already written). Place it next
to run.mjs and apply `run-mjs-questionsavoided-patch.md`:

- import `questionsAvoided as qaWeight`.
- Replace `questionsAvoided: populated` with the data-point computation:
  - `questionsAvoided`    = weight of verified + probable fields
  - `questionsPredrafted` = weight of indicative fields
  - `questionsAvoidedTotal` and `questionsAvoidedFields` (old number, kept)
- Stakeholder weight counts ONLY these attrs: full_name, role,
  share_percentage, nationality, date_of_birth, residential_country, id_type,
  id_number, is_pep. Address counts non-empty sub-fields. Scalars = 1.
- Run in mode (a): pass `SCHEMA_WEIGHTS = null` so it computes from stored
  `found` arrays retroactively. Leave the commented mode-(b) example in place.
- Aggregate and print all four; console shows avoided + predrafted on two lines.

---

## CHANGE 4 — Metric #4: Evidence coverage = credible-source share (Path A)

Apply `evidence-coverage-pathA-patch.md`:

- Redefine `evidenceCoverage` = (tier1 + document + tier2 fields) / found.length.
- Keep old presence-of-any-source check as `evidenceFloor` (sanity only).
- Leave `tier1Share` (tier-1 only) untouched.
- Console label: "(filled fields backed by a tier-1/tier-2 source)".
- Resulting ladder: evidenceFloor >= evidenceCoverage >= tier1Share.

---

## CHANGE 5 — Metrics #3 & #6: baseline as LOW/HIGH band

Currently a single `--baseline` (default 25). Replace with a band so research
reduction and speedup show best/worst case per the onboarding-expert range
(corporate review time ~30 min to ~2 hr; varies by jurisdiction).

- Add CLI args `--baselineLow` (default 30) and `--baselineHigh` (default 120).
  Keep `--baseline` working as a single-value fallback = sets both low and high
  equal.
- For each entity compute, for BOTH bounds:
  - researchReductionPctLow/High = (baseline - timeMin) / baseline
  - speedupLow/High              = baseline / timeMin
  - analystMinSavedLow/High      = baseline - timeMin
- Display #3 and #6 as ranges, e.g. "97%–99%" and "38x–150x", and lead the
  minutes-saved figure as a BAND: "≈29–119 min analyst research saved / entity".
- Keep the provisional baseline banner (`baseline-banner-patch.md`) but update
  its text to state the BAND and that it is an SME estimate, research/
  data-gathering only (excludes screening/EDD/QC), flat across segments.

---

## CHANGE 6 — Confidence bar: readable legend

Apply `confidence-bar-legend-patch.md`:
- In-bar % label only on segments >= 8% wide.
- Add a legend below the bar printing High / Medium / Low values always (the
  ~0.7% Medium sliver is unreadable inside the bar). Add `title` tooltips.

---

## After applying
1. Recompute ALL metrics over the stored pilot dataset (12 entities).
2. Regenerate `scorecard.html` and the console summary.
3. Print a before/after table for the metrics that changed definition:
   questions-avoided (field-level vs data-point), evidence coverage (old 100%
   vs new tier1+2), and the new form-pre-fill-rate column — so the deltas are
   visible.
4. Sanity-check: customerSupplied fields are excluded from coverage denominators;
   pre-fill rate is reported per segment; no metric reads a flat 100% across all
   entities except evidenceFloor.

---

## DEFERRED — DO NOT IMPLEMENT IN THIS PASS
Deterministic confidence rule (source-tier + corroboration -> verificationStatus,
to remove run-to-run grading wobble seen in the consistency repeats). We agreed
to define the rule (corroboration definition, treatment of volatile fields like
revenue/headcount) together BEFORE coding. Leave confidence assignment as-is for
now. Do not touch verificationStatus logic.
