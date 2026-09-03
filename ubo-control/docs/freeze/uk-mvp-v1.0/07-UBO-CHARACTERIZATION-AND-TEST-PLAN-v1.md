# 07 — UBO Characterization and Test Plan v1

**Status:** CONTROL ROOM TEST FREEZE  
**Rule:** No production behaviour is complete without same-PR protection

---

# 1. Purpose

The test net must protect:

- legal/policy semantics;
- deterministic arithmetic and attribution;
- provider boundaries;
- identity and claim integrity;
- InformationNeed granularity;
- low-friction planning;
- applicant and analyst projections;
- historical reconstruction;
- real-company regressions.

Counts alone are not evidence of completeness. Every frozen doctrine must map to executable cases.

---

# 2. Permanent test layers

1. Architecture tests.
2. Public contract tests.
3. Capability adapter tests.
4. Candidate/claim/identity tests.
5. Graph invariants.
6. Arithmetic tests.
7. Qualification/attribution tests.
8. Policy Pack validation.
9. Requirement/InformationNeed tests.
10. Planner/acquisition tests.
11. DecisionSnapshot/history tests.
12. Projection/UI tests.
13. Lab end-to-end tests.
14. Host regression tests.
15. Evidence adapter tests when Gate 4 resumes.

---

# 3. Existing behaviours to preserve

- no legacy imports in core;
- no Evidence implementation imports in core;
- candidate facts not conclusions;
- no direct graph mutation;
- exact/range/unknown;
- no float drift;
- path multiplication;
- independent-path aggregation;
- duplicate evidence not duplicate ownership;
- incompatible operative claims fail;
- NO_PATH not zero;
- cycles fail safe;
- voting/economic separation;
- operational failure not NO_DATA;
- explicit identity and adjudication;
- immutable snapshots;
- customer action through application boundary;
- replay performs no live paid search;
- one canonical entity = one visual node.

---

# 4. New Doctrine A tests

## Threshold/comparator matrix

For the same graph test:

- statutory `>25`;
- statutory `>=25`;
- firm `>=10`;
- statutory + firm simultaneously.

Verify distinct statutory/firm outputs and labels.

## Firm overlay

- 15% person is firm-policy person under >=10;
- not statutory UBO under >25;
- host handoff retains both classifications;
- firm threshold cannot suppress a statutory UBO.

---

# 5. New Doctrine B tests

## Closure truth table

- `(75,100]` + `>25` → CLOSED;
- `[75,100]` + `>=25` → OPEN;
- `[76,100]` + `>=25` → CLOSED;
- 75% + firm >=10 → OPEN;
- 40% + 35% lower bounds, >25 → CLOSED;
- unknown/unidentified holder → INDETERMINATE.

## Qualifiers

- dual-class shares: economic closed, voting open;
- invalid denominator blocks closure;
- overlapping interests fail;
- contradictory sources block closure;
- stale/currentness unknown blocks closure where material;
- joint-arrangement signal blocks closure;
- closure does not imply exact value verified.

## Precision

- band wholly above/below threshold → no exact request;
- interval straddles outcome → exactness needed;
- registry band + declaration → corroborated state;
- outside-band declaration → conflict.

---

# 6. New Doctrine C tests

## Effective interest

Retain all existing arithmetic cases.

## PSC attribution

- 60% TopCo; TopCo 40% Customer → effective 24%, attribution positive;
- 30% TopCo; TopCo 40% Customer → effective 12%, no majority attribution;
- 75–100 chain through several entities → attribution chain positive;
- one 25–50 link breaks majority chain;
- voting right attributed separately;
- appointment/removal majority;
- SIoC positive;
- UNKNOWN majority step → indeterminate;
- no mixed-method percentage;
- multiple qualifying routes retained for one person.

## Joint arrangements

After sign-off:

- two explicit joint participants are each attributed combined right;
- similar percentages without evidence do not infer joint arrangement;
- positive signal routes to review where not deterministic.

## LLP

After sign-off:

- surplus-asset condition;
- LLP voting;
- majority management appointment/removal;
- LLP majority-chain attribution;
- TDR characterization remains provisional until sign-off fixture enabled.

---

# 7. Listed tests

- listed customer with valid market/evidence → listed route;
- invalid/non-qualifying market → no shortcut;
- majority-owned consolidated subsidiary with all proof → treatment after sign-off;
- missing consolidation evidence → unresolved;
- arbitrary intermediate listed parent does not terminate by default;
- enabled firm-approved branch terminus pins rule/evidence.

---

# 8. InformationNeed tests

- one missing frontier edge creates one causal need;
- downstream affected paths link to that need;
- no need per intermediary;
- no duplicate projection count;
- subject-level R04 remains;
- intermediary R04 only on attribution chain/positive signal;
- R02/R03 activate from graph-derived facts;
- R07 activates from qualifying-person output;
- R08 remains one structure-level need;
- positive trust/nominee signal remains separate;
- negative residual statements do not fan out.

---

# 9. Planner/acquisition tests

- Discovery-led when capability profile predicts coverage;
- predictive chart pivot on opaque frontier;
- pivot before paid attempt where configured capability proves unavailable;
- repeated NO_DATA and common structural cause collapse into one structure request;
- chart offered as candidate structure, not proof;
- accessible extracted edges independently verified;
- residual unsupported edges batched;
- no oscillation without material change;
- RegistryCapabilityProfile version/hash pinned;
- provider outage does not burden customer;
- guided builder alternative for no-chart SME;
- delegation preserves actor/capacity.

---

# 10. Residual confirmation tests

After wording/sufficiency sign-off:

- one interaction, multiple stored statements;
- each statement independently resolves/branches;
- one positive does not invalidate other negatives;
- blocked by contrary evidence;
- allowed only at approved risk tier;
- final completeness does not cure ownership gap.

---

# 11. SMO/exhaustion tests

- measure categories considered and dispositioned;
- non-executed measure requires reason;
- case-specific manifest, not universal execution checklist;
- analyst/compliance decision required;
- NO_DATA alone never triggers fallback;
- operational failure blocks/redirects appropriately;
- customer refusal → CDD failure, not fallback;
- valid fallback preserves written record and SMO downstream handoff;
- stale review invalidated by material case change.

---

# 12. R09 tests

- first-RLE/register-scope difference;
- effective-interest-only person absent from register → METHOD_DIFFERENCE;
- timing/staleness;
- actual contradictory registrable fact → review;
- analyst-confirmed material discrepancy → Reg 30A report candidate;
- no automatic regulatory submission.

---

# 13. ASDA permanent characterization

Protect:

- 12 canonical entities from the sanitized case;
- no duplicate exact registry IDs;
- three TDR persons are voting `(25,50]`, not economic owners;
- mixed voting/economic path is not multiplied;
- economic chain bands retained;
- Schedule 1A route evaluated independently;
- TDR governance frontier, not per-intermediary fan-out;
- causal needs not double-counted as paths;
- ownership-first graph with control toggles;
- no blanket unresolved nodes;
- 2–4 coherent applicant interactions as benchmark;
- final TDR natural-person result marked provisional until A06 sign-off.

Do not hard-code named people as final UBOs.

---

# 14. Customer journey tests

- data-rich confirmation only;
- known information not re-requested;
- exactness question only when decision-sensitive;
- chart-assisted route;
- no-chart guided builder;
- one batched residual screen;
- separate structured statements;
- Something Changed route preserves history/conflict;
- delegation;
- customer input complete while internal review pending;
- downstream IDV handoff separate.

---

# 15. Lab/analyst tests

- one graph;
- ownership default;
- control toggles;
- Fit width/overview;
- deterministic unresolved list;
- edge status vocabulary;
- node not blanket unresolved;
- qualification explanation by route;
- effective-interest and attribution shown separately;
- evidence states visible;
- old snapshots reconstruct unchanged;
- review-policy watermark.

---

# 16. Runtime safety tests

- non-approved pack rejected outside Lab;
- null effective date rejected;
- missing approver rejected;
- unresolved blocking sign-off rejected;
- unsupported policy/algorithm combination rejected;
- historical pack remains reconstructable;
- DecisionSnapshot pins RegistryCapabilityProfile when used.

---

# 17. Implementation gate order

Recommended PR waves:

1. schema/runtime approval guard;
2. Policy Pack v1.6-RC container/content;
3. qualification-basis model;
4. Schedule 1A attribution for companies;
5. LLP attribution only after sign-off;
6. layer-closure evaluator;
7. phased evaluation;
8. frontier InformationNeeds;
9. planner chart pivot / capability profile;
10. Lab projection remediation;
11. customer journey updates;
12. Evidence integration;
13. onboarding integration.

Each wave stops for Control Room review.

---

# 18. Defect rule

Any Lab/practitioner defect must have:

1. reproducible characterization fixture;
2. failing regression test;
3. root-cause fix at earliest correct layer;
4. full regression;
5. manual acceptance where UX is involved.

No presentation patch may hide a semantic defect.

---

# 19. Traceability matrix requirement

Codex must update TEST_MATRIX so every frozen doctrine section maps to:

- test file;
- test name;
- policy version;
- implementation version;
- current status;
- sign-off dependency if any.

Unimplemented/sign-off-gated cases remain visibly pending.
