# 03 — UBO Deterministic Domain Change Specification

**Status:** CONTROL ROOM CHANGE SPEC  
**Purpose:** Change the fresh deterministic engine without weakening existing boundaries

---

# 1. Preserve existing engine capability

Do not rewrite:

- OwnershipCase;
- candidate claims;
- explicit identity/adjudication;
- canonical graph;
- exact rational arithmetic;
- range endpoint semantics;
- path multiplication;
- independent-path aggregation;
- cycle protection;
- strict dimension separation;
- DecisionSnapshots/history;
- two capability ports;
- Evidence boundary.

This change adds missing doctrine and corrects orchestration/granularity.

---

# 2. New qualification model

Introduce an immutable `QualificationBasis` or equivalent capable of recording:

- person ID;
- status;
- statutory/firm-policy classification;
- legal route/limb;
- condition;
- dimension;
- direct/indirect;
- method;
- method status;
- algorithm version;
- calculation/attribution trace;
- graph relationship/claim/evidence references;
- Policy Pack identity.

One person may have multiple bases.

The person is a statutory beneficial owner where any applicable statutory route is satisfied.

---

# 3. Effective-interest engine remains unchanged

Retain `ubo-percentage-lookthrough-v1` or current equivalent.

It remains responsible only for:

- homogeneous economic calculations;
- homogeneous voting calculations;
- exact/range/unknown arithmetic;
- multiply along path;
- aggregate same-person paths;
- path diagnostics;
- no mixed-dimension inference;
- no policy threshold inside arithmetic.

Mark the method as `ADOPTED_INTERPRETATION` in reasoning output.

---

# 4. Add Schedule 1A attribution engine

Add a separate algorithm:

`ubo-psc-attribution-v1`

It must not reuse percentage multiplication as a proxy.

## 4.1 Inputs

- canonical graph;
- operative rights/relationships;
- entity profiles;
- policy condition configuration;
- direct/indirect relationship facts;
- majority-stake facts;
- currentness;
- relevant joint-interest/joint-arrangement facts;
- evidence/claim references.

## 4.2 Supported condition families

Subject to legal mapping/sign-off:

- shares/economic right above condition threshold;
- voting right above condition threshold;
- right to appoint/remove majority;
- significant influence/control;
- trust/firm condition;
- direct and indirect holding through majority-stake chains.

## 4.3 Majority-stake chain

Represent each majority-chain step explicitly.

Do not infer majority from a non-majority percentage.

Ranges may prove majority where the entire interval is above 50%.

Examples:

- `(75%,100%]` proves majority;
- `(25%,50%]` does not prove majority;
- `[50%,100%]` requires comparator-specific handling;
- UNKNOWN is unresolved.

## 4.4 Attribution output

Return:

- condition;
- attributed right;
- person;
- target subject;
- chain entities/edges;
- each step's majority basis;
- direct holder/right at customer;
- status: satisfied / not satisfied / indeterminate / review;
- policy/legal basis;
- evidence references.

No naked `isPsc`.

---

# 5. Management-control route

Preserve ultimate-management-control as separate from:

- effective percentage ownership;
- Schedule 1A mechanical attribution.

Use deterministic positive facts where conclusive.

Use review where governance/de facto control requires interpretation.

Do not turn job title, seniority, age or pay into automatic control.

---

# 6. Joint arrangements

Add a domain representation only after sign-off.

Required capability:

- preserve source assertion that interests/rights are held jointly or under a joint arrangement;
- distinguish explicit evidence from inference;
- support condition attribution where each participant is treated as holding the combined right under approved legal mapping;
- never infer a joint arrangement from three similar percentages alone.

Until approved:

- positive signal → review/specialist;
- no automatic attribution.

---

# 7. Layer-closure evaluator

Add a pure deterministic evaluator separate from qualification.

Inputs:

- direct holder intervals;
- dimension;
- statutory threshold/comparator;
- optional firm threshold/comparator;
- denominator state;
- identity/currentness/conflict/joint-arrangement qualifiers.

Outputs:

- `statutoryClosure`;
- `firmPolicyClosure`;
- `exactnessNeededForDetermination`;
- blocking qualifiers;
- residual interval;
- contributing relationships.

States should distinguish:

- CLOSED;
- OPEN;
- INDETERMINATE;
- REVIEW_REQUIRED.

Closure is not a final UBO result.

---

# 8. Percentage evidence classification

Preserve three distinct states in evidence-policy reasoning:

- DECLARED_EXACT;
- INDEPENDENT_BAND_CORROBORATED;
- EXACT_VALUE_VERIFIED.

Do not mutate the numeric fact merely because evidence classification changes.

A customer exact value may become the operative numeric claim only under an approved evidence/adjudication rule. The official band remains separate evidence.

---

# 9. Phased reasoning coordinator

Enforce:

1. base applicability;
2. graph/depth;
3. calculations/attributions;
4. qualification;
5. derived requirement applicability;
6. evidence sufficiency;
7. InformationNeeds;
8. resolution planning;
9. snapshot.

No circular dependency.

Examples:

- R02/R03 applicability derives from graph;
- R07 applicability derives from qualifying persons;
- planner consumes needs but cannot create legal qualification;
- snapshot pins all earlier phase versions.

---

# 10. Frontier calculation planning

Replace broad “calculate every reverse-reachable upstream entity in every dimension” planning.

Plan calculations/attributions for:

- observed natural persons with a relevant path/right;
- current unresolved ownership frontier;
- legal entities holding a qualifying or potentially qualifying control right;
- entities needed by Schedule 1A attribution;
- entities needed to resolve same-person path aggregation;
- explicit policy-required structural diagnostics.

Intermediate entities do not automatically receive independent person-level basis assessments.

---

# 11. Control-chain composition

When a legal entity holds a potentially qualifying right:

- preserve the right at the customer;
- determine whether policy requires identifying the natural person who controls that holder;
- create/follow only the relevant control/attribution frontier;
- do not open every control dimension across every economic intermediary.

No mixed economic/voting multiplication.

Schedule 1A attribution and effective interest remain separate outputs.

---

# 12. Listed treatment domain support

Add policy-driven terminal/scope outcomes, not hard-coded market logic.

Support:

- customer listed;
- customer consolidated subsidiary of listed;
- intermediate listed terminus disabled/enabled by policy.

Domain verifies required facts; policy decides consequence.

No automatic terminus for any node carrying a “listed” label.

---

# 13. R09 mismatch classification

Add deterministic comparison categories:

- REGISTER_SCOPE_DIFFERENCE;
- METHOD_DIFFERENCE;
- TIMING_STALENESS;
- MATERIAL_DISCREPANCY;
- INDETERMINATE/REVIEW where needed.

A legitimate effective-interest versus PSC-attribution difference is not automatically a reportable discrepancy.

Regulatory submission remains outside UBO; UBO emits a report candidate only after approved review.

---

# 14. RegistryCapabilityProfile pinning

The planner may receive a provider/configuration capability profile.

The domain must:

- treat it as planning context, not evidence of ownership;
- validate ID/version/hash;
- include the identity in ResolutionPlan and DecisionSnapshot when used;
- preserve entitlement context;
- never import provider implementation types.

---

# 15. Snapshot changes

New snapshots must pin:

- qualification method/status;
- Schedule 1A attribution algorithm version;
- layer-closure algorithm version;
- RegistryCapabilityProfile identity where used;
- statutory versus firm-policy basis;
- sign-off-gated policy state.

Historical snapshots remain untouched.

---

# 16. Compatibility

- old snapshots reconstruct under their original algorithms;
- v1.5-RC decisions are not retroactively reclassified;
- new re-resolution produces new snapshots;
- no public capability-port change;
- public projection contracts may require additive fields/versioning;
- Lab must visibly identify old versus new doctrine.

---

# 17. Domain errors

Add typed failures for:

- unsupported qualification method;
- policy/algorithm mismatch;
- invalid majority chain;
- incompatible entity-profile attribution;
- unresolved required sign-off;
- ambiguous joint arrangement;
- invalid closure denominator;
- inconsistent overlapping intervals;
- stale RegistryCapabilityProfile pin.

No provider-specific errors.

---

# 18. Mandatory characterization examples

## Effective interest

- 60% × 50% = 30%;
- two paths 18% + 10% = 28%;
- range multiplication;
- range aggregation;
- NO_PATH is not zero;
- cycle fail-safe.

## Attribution

- 60% TopCo → TopCo 40% Customer: effective 24%, attribution positive;
- 30% TopCo → TopCo 40% Customer: effective 12%, no majority attribution;
- deep majority chain with 75–100 bands: attribution chain valid;
- one non-majority link breaks attribution;
- voting condition separate from economic;
- appointment/removal majority;
- explicit SIoC;
- LLP variants after sign-off.

## Closure

- `(75,100]` against `>25` closes;
- `[75,100]` against `>=25` remains open;
- 75% against firm `>=10` remains open;
- dual-class shares prevent voting closure;
- unidentified 75% holder prevents closure;
- contradiction prevents closure;
- joint-arrangement signal prevents closure;
- exactness requested only when result straddles.

---

# 19. Explicit non-goals

Do not:

- implement sanctions 50% aggregation in this cycle;
- add other jurisdictions;
- implement FIRM_LAYER_HOLDER_COLLECTION;
- make Evidence Platform authoritative;
- change legacy Discovery;
- auto-infer joint arrangements;
- decide TDR-specific control without sign-off;
- treat the Lab as applicant UX;
- make policy-signoff placeholders executable in production.
