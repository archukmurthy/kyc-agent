# 01 — UBO Control UK MVP Doctrine Freeze v1.0

**Status:** CONTROL ROOM FREEZE  
**Scope:** UK corporate and UK LLP MVP  
**Buyer:** FCA-regulated payment institutions and electronic-money institutions  
**Guidance profile:** JMLSG  
**Date:** 3 September 2026

---

# 1. Product objective

UBO Control must:

> Establish beneficial ownership and control using available facts, apply the active policy, identify precisely what remains material and unresolved, and drive the minimum defensible next action.

It is not a questionnaire engine and not a registry-wrapper.

The customer is asked only for information that cannot reasonably be established through already-held facts, Discovery, existing artifacts, Extraction or internal review.

---

# 2. Legal and guidance baseline

The UK MVP is anchored in:

- MLR 2017 Regulation 5;
- Regulation 6 where a trust/similar arrangement is involved;
- Regulation 28, including identification, reasonable verification measures, ownership/control understanding, listed-customer treatment, SMO fallback and written records;
- Regulation 30A discrepancy assessment/reporting handoff;
- Companies Act 2006 Schedule 1A PSC conditions and attribution rules;
- LLP modifications and in-force LLP significant-influence/control guidance;
- current approved JMLSG guidance as the primary supervisory-practice profile.

SI 2026/621 is in force for its principal provisions from 30 June 2026. The current source-based review indicates no change to the core Regulation 5 / Regulation 28(3A)–(9) beneficial-owner machinery, but a formal clause-by-clause delta memo remains a sign-off item.

This pack is internal product policy design and is not external legal advice.

---

# 3. Architecture invariants

## 3.1 Candidate facts before conclusions

DiscoveryService and ExtractionService return candidate facts with durable support references.

They cannot determine:

- operative claims;
- ownership graph truth;
- effective ownership;
- threshold qualification;
- UBO/PSC/controller status;
- gaps;
- customer actions.

## 3.2 Evidence versus UBO

> Evidence returns facts with durable proof. UBO returns conclusions with durable reasoning.

UBO retains provider-neutral EvidenceReferences, not raw evidence bytes or a second evidence repository.

## 3.3 Standalone portability

Core UBO code must remain extractable as a standalone product.

Host, provider and Evidence adapters depend inward on UBO public contracts. UBO core never depends outward on those adapters.

## 3.4 Durable reasoning

Every meaningful determination must retain:

- Policy Pack ID/version/hash;
- algorithm versions;
- operative claims;
- graph version;
- calculations/attributions;
- qualifying bases;
- requirement states;
- InformationNeeds;
- actions/reviews;
- terminal/current state.

---

# 4. Doctrine A — threshold, comparator and firm overlay

## 4.1 Statutory qualification threshold

For the current UK corporate/LLP profile, the statutory percentage test is policy-owned and dimension-specific.

Current baseline:

- economic/share or LLP-equivalent interest: **more than 25%**;
- voting rights: **more than 25%**.

The comparator is exclusive (`>`), not silently `>=`.

The generic engine must never hard-code 25.

## 4.2 Firm collection threshold

A deploying firm may adopt a stricter collection/materiality threshold, for example `>=10%`.

It may not use a looser threshold to avoid the statutory rule.

People captured only by the firm threshold must be labelled separately, for example:

- `firm_policy_qualifying_person`

They must not be described as statutory beneficial owners merely because firm policy collects them.

## 4.3 Separate outputs

Qualification and closure results must be capable of returning independently:

- statutory qualification/closure;
- firm-policy qualification/closure;
- exactness required for the current determination.

---

# 5. Doctrine B — ownership-layer completeness

Retire the vague phrase **entity resolved**.

An entity can be identified while one particular fact, edge, dimension or evidence condition remains unresolved.

Layer completeness is assessed:

- per direct ownership layer;
- per dimension;
- under the active threshold/comparator;
- with interval semantics;
- subject to explicit qualifiers.

## 5.1 Closure arithmetic

Let `S` be the sum of the lower bounds of current, identified, non-overlapping direct holdings in one dimension, against a valid denominator.

For a threshold `> t`, additional-holder discovery is closed when the maximum residual cannot exceed `t`.

For a threshold `>= t`, closure is stricter because an exact residual equal to `t` may qualify.

Examples:

- identified holding `(75%,100%]`; statutory `>25%`: residual is always below 25%, so no other direct economic holder can qualify;
- identified holding `[75%,100%]`; statutory `>=25%`: a 25% residual may qualify, so the layer is not closed;
- firm threshold `>=10%`: 75% accounted for does not close the firm-policy layer.

## 5.2 Closure qualifiers

Arithmetic cannot close the layer unless:

- holders are identified;
- holdings use the same compatible dimension/denominator;
- denominator and relevant share-class treatment are sufficiently established;
- treasury/non-participating interests are handled where material;
- holdings do not overlap;
- no material contradiction remains;
- no material joint-interest/joint-arrangement signal remains unresolved;
- temporal/currentness is sufficient.

Economic closure never automatically closes voting rights.

## 5.3 Percentage evidence states

Preserve:

- `DECLARED_EXACT`
- `INDEPENDENT_BAND_CORROBORATED`
- `EXACT_VALUE_VERIFIED`

A declaration of 80% that fits a 75–100% official band is consistent and independently band-corroborated. The band does not independently prove the exact 80%.

Whether declaration + band is operationally sufficient at a given risk tier requires Policy Pack/MLRO approval.

## 5.4 Decision-sensitive precision

Do not ask for an exact percentage merely because only a band is known.

Ask for exactness only where the range can change:

- qualification;
- closure;
- attribution;
- evidence sufficiency;
- another active policy result.

---

# 6. Doctrine C — qualification and calculation

The UK beneficial-owner determination is not one percentage calculation.

The engine must assess separate statutory routes and retain the route(s) that succeed.

## 6.1 Route 1 — ultimate management control

Method:

- evidence assessment;
- deterministic positive facts where the policy makes them conclusive;
- analyst/compliance review where facts require interpretation.

This is not percentage arithmetic.

## 6.2 Route 2 — effective interest

Method identity:

- `EFFECTIVE_INTEREST`
- method status: `ADOPTED_INTERPRETATION`

Current deterministic semantics remain:

1. multiply compatible percentages along each homogeneous economic or voting path;
2. preserve exact/range/unknown values and endpoint attainability;
3. aggregate distinct relevant paths for the same canonical natural person;
4. do not traverse economic edges in a voting calculation or vice versa;
5. do not interpret `NO_PATH` as zero;
6. do not manufacture answers through cycles or unknown edges.

## 6.3 Route 3 — Schedule 1A / PSC-condition attribution

Method identity:

- `PSC_CONDITION_ATTRIBUTION`
- method status: `STATUTORY_ATTRIBUTION_SEMANTICS`
- proposed algorithm: `ubo-psc-attribution-v1`

This is a separate route, not a replacement for effective-interest arithmetic.

It must assess relevant Schedule 1A conditions, including direct and indirect holding through a qualifying majority-stake chain, and preserve:

- condition;
- direct/indirect basis;
- majority-chain trace;
- source facts;
- legal basis;
- uncertainty/review state.

A person qualifies as a statutory beneficial owner where any applicable statutory route is satisfied.

## 6.4 Worked distinction

Alice owns 60% of TopCo. TopCo owns 40% of Customer.

- Effective-interest route: 24%; percentage test not satisfied.
- Schedule 1A attribution route: may attribute the 40% right through Alice's majority stake in TopCo, subject to exact statutory mapping.
- Result must retain the route rather than collapsing to `ubo=true`.

## 6.5 Firm layer-holder collection

A practice such as “collect anyone over 25% at any layer” is not multiplication or path aggregation.

It remains a deferred firm-policy option:

- `FIRM_LAYER_HOLDER_COLLECTION`
- not statutory by default;
- requires a real firm SOP;
- projects a firm-policy role, not statutory UBO status.

## 6.6 Qualification record

Every qualifying result must contain:

- person;
- statutory or firm-policy status;
- qualifying route/limb;
- condition/dimension;
- direct or indirect;
- method and algorithm version;
- calculation/attribution trace;
- graph/claim/evidence references;
- Policy Pack identity.

Never expose only a naked boolean.

---

# 7. Doctrine D — control assessment and customer-action gating

## 7.1 Assessment is not interrogation

Applicable ownership and control conditions remain first-class and must be assessed.

That does not mean asking the customer detailed voting, appointment and significant-control questions at every intermediary.

## 7.2 Regulated-subject assessment

At the regulated customer, assess:

- economic ownership;
- voting rights;
- appointment/removal control;
- other significant influence/control;
- ultimate management control where applicable.

Use available registry, filings, governance evidence and extracted facts first.

## 7.3 Intermediary control needs

An intermediary should generate a control InformationNeed only where:

- it lies on a control/attribution chain relied upon for the customer determination;
- a positive control signal exists at that intermediary;
- the natural person behind a qualifying legal-entity-held right remains unresolved;
- no statutory route can yet be assessed without that control fact;
- a policy-specific structural requirement makes the fact material.

Do not generate a full R04/R05/R06 questionnaire merely because an intermediary appears in an economic chain.

## 7.4 Numeric customer control input

Detailed voting/appointment questions are `LAST_RESORT_GATED`, not forbidden.

They are permitted only when:

- the fact is material to the determination;
- existing facts, Discovery and governance documents cannot reasonably establish it;
- the active policy permits customer-originated input;
- the respondent is authorised and plausibly knowledgeable;
- required corroboration/review follows.

## 7.5 Residual confirmation bundle

Use one low-friction customer interaction where policy permits, but retain separate structured statements for:

- undisclosed other significant control;
- trust/similar arrangement involvement;
- nominee/bearer arrangement;
- relevant joint arrangement;
- final completeness.

One positive answer affects only its own statement and follow-up.

The wording and sufficiency remain sign-off gated.

---

# 8. Doctrine E — listed treatment, exhaustion, fallback and terminal states

## 8.1 Listed treatment: three separate cases

### A. Customer listed on a qualifying regulated market

Apply the statutory/customer-level listed treatment after verifying and retaining evidence of the listing/disclosure regime.

### B. Customer is a majority-owned, consolidated subsidiary of a qualifying listed company

Treat as a distinct JMLSG-based customer-level rule, subject to proof of:

- qualifying listing;
- majority ownership;
- consolidation.

Exact current JMLSG paragraph/evidence standard remains a sign-off item.

### C. Arbitrary intermediate listed parent

No automatic branch terminus.

Optional policy only:

- OFF by default;
- explicit MLRO/legal approval;
- qualifying market list;
- listing/disclosure evidence;
- clear branch-terminal rationale.

## 8.2 Exhaustion

The engine must record categories of potentially relevant measures and their case-specific dispositions:

- `EXECUTED`
- `UNAVAILABLE`
- `IRRELEVANT`
- `DISPROPORTIONATE`

Every omitted avenue requires a reason.

This is not a mandatory universal execution checklist.

## 8.3 SMO fallback

SMO fallback remains asynchronous and case-specific.

The machine:

- records attempts, outcomes, blockers and unresolved matters;
- packages the measures manifest;
- verifies machine preconditions.

An authorised ANALYST or COMPLIANCE decision confirms that all reasonable means relevant to the case have been exhausted.

The snapshot preserves the written record.

The customer journey never waits synchronously for this decision.

## 8.4 Failure and terminal states

Retain:

- `RESOLVED`
- `RESOLVED_PROVISIONALLY`
- `RESOLVED_VIA_SMO_FALLBACK`
- `SPECIALIST_REVIEW_REQUIRED`
- `UNRESOLVABLE`
- `CDD_FAILURE`

CDD failure is distinct from a valid fallback and remains a host/downstream relationship-decision and SAR-consideration handoff.

---

# 9. Doctrine F — structure acquisition strategy

This is primarily Resolution Planner/product logic, not the statutory UBO definition.

Use:

- `DISCOVERY_LED`
- `CHART_ASSISTED`
- `SPECIALIST`

## 9.1 Discovery-led

Use available zero-customer-friction sources to reconstruct the material ownership/control structure.

Continue while Discovery is expected to resolve material frontier facts efficiently.

## 9.2 Chart-assisted

Pivot when structure opacity is predicted or demonstrated and recursive customer questions would be inefficient.

Acceptable structure evidence may include:

- ownership chart;
- cap table;
- shareholder register;
- group-structure note in accounts;
- registry extract;
- legal/accounting structure memorandum;
- jurisdiction-equivalent corporate ownership document;
- guided add-a-node structure input for smaller businesses without a chart.

The chart is candidate structure, not proof.

Every extracted node/edge enters normal claim validation/adjudication.

Accessible material relationships are independently verified; residual unsupported relationships are batched.

## 9.3 Predictive pivot

A versioned RegistryCapabilityProfile may inform the planner using:

- jurisdiction;
- entity type;
- provider entitlement;
- identity/ownership/control data available;
- exactness/bands;
- filings available;
- access restrictions;
- freshness.

The planner may pivot before spending provider attempts where opacity is predictable.

The profile ID/version/hash and entitlement context must be pinned in the ResolutionPlan and DecisionSnapshot.

## 9.4 No oscillation

Select acquisition strategy once per resolution wave.

Re-evaluate after new facts/evidence.

Do not oscillate between routes without a material state change.

## 9.5 Specialist

Route out of ordinary Corporate/LLP deterministic handling where current MVP policy cannot safely resolve:

- trust or trust-like arrangement requiring trust determination;
- ordinary partnership or fund limited partnership;
- foundation;
- state/sovereign structure;
- bearer signal;
- unresolved nominee principal after permitted resolution;
- positive joint-arrangement signal not deterministically expressible;
- ambiguous/de facto control;
- other approved specialist conditions.

---

# 10. How far to unwrap

Do not use either extreme:

- “stop when the multiplied branch falls below 25%”; or
- “continue until any human appears and call that human the UBO”.

Continue resolving a branch until the active policy can determine every potentially qualifying route, achieve its required structural understanding, or apply a permitted terminal/specialist outcome.

Relevant reasons to continue include:

- same-person path aggregation is still possible;
- Schedule 1A majority-chain attribution may still qualify someone;
- a legal entity holds a potentially qualifying control right;
- firm policy has a stricter collection threshold;
- structural/evidence requirements remain material.

A terminal natural person with a sub-threshold economic interest is not automatically a UBO.

---

# 11. InformationNeeds

An InformationNeed represents a specific missing fact or proof condition.

It is not a customer question.

Generate needs at:

- the regulated subject;
- a blocking frontier entity;
- a blocking relationship/edge;
- a qualifying person's missing identity attribute;
- a required analyst/specialist decision.

Do not fan out one need to every downstream entity affected by the same missing edge.

Dependent calculations/path diagnostics are attached to the causal need.

---

# 12. Evaluation order

Use a phased acyclic pipeline:

1. base case applicability;
2. canonical graph and structural depth;
3. effective-interest and attribution calculations;
4. statutory and firm-policy qualification;
5. derived requirement applicability;
6. evidence sufficiency;
7. InformationNeeds/gaps/blockers;
8. resolution planning;
9. DecisionSnapshot.

A phase may consume only earlier-phase outputs.

---

# 13. Applicant versus Lab

The Lab is an analyst/Control Room microscope.

The applicant journey is deliberately small.

Typical applicant interactions should be:

- confirm what the system established, with as-at date and confirmer capacity;
- provide one targeted missing fact;
- provide a chart/structure evidence where that is more efficient;
- complete one bundled residual confirmation containing separate statements;
- provide/complete downstream identity verification for determined persons through the wider KYC product.

The applicant must not see the Lab's diagnostic complexity.

---

# 14. ASDA characterization objective

ASDA is a permanent characterization case.

Target:

- no per-intermediary R01/R04 fan-out;
- faithful source dimensions;
- ownership-first graph with optional control overlays;
- frontier/edge-level unresolved states;
- TDR governance/control uncertainty exposed honestly;
- approximately 2–4 coherent applicant interactions, depending on actual evidence and legal sign-off;
- no hard-coded ASDA count or final UBO answer.

The TDR natural-person outcome remains provisional pending LLP/joint-arrangement sign-off.

---

# 15. Prohibited shortcuts

Do not:

- use registry silence as proof of absence;
- treat one registry band as exact verification;
- relabel firm-policy persons as statutory UBOs;
- traverse voting facts through economic edges;
- automatically mark customer claims operative;
- modify legacy Discovery;
- let Evidence decide UBO status;
- generate customer work from every InformationNeed;
- ask all control questions at every intermediary;
- treat charts as proof;
- use unapproved Policy Packs in production;
- hard-code the current ASDA outcome.
