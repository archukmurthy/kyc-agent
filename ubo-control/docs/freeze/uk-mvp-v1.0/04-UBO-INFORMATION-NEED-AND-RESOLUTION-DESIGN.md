# 04 — InformationNeed and Resolution Design

**Status:** CONTROL ROOM FREEZE  
**Objective:** Replace entity fan-out with causal, frontier-based resolution

---

# 1. Core distinction

An InformationNeed means:

> A specific fact, proof condition or decision is required before a policy determination can be completed defensibly.

It is not:

- a question;
- a document request;
- a provider call;
- a gap screen;
- an entity-wide “unresolved” label.

---

# 2. Causal granularity

Every need must identify the smallest causal target that blocks reasoning.

Supported target kinds:

- CASE / regulated subject;
- FRONTIER_ENTITY;
- RELATIONSHIP / EDGE;
- PERSON_ATTRIBUTE;
- QUALIFICATION_ROUTE;
- REVIEW_DECISION;
- EVIDENCE_SUFFICIENCY;
- SPECIALIST_ROUTE.

Do not create one need for every downstream calculation affected by one missing edge.

Attach dependent path/calculation diagnostics to the causal need.

---

# 3. Frontier concept

The frontier is the topmost/current point at which a material ownership/control branch cannot proceed.

Examples:

- direct holder of Customer known, owner of HoldCo unknown → frontier = HoldCo;
- HoldCo owner known but ownership percentage unknown → frontier need = that relationship percentage;
- legal entity holds appointment control, natural controller unknown → frontier = control-holder entity;
- trust appears → specialist frontier.

Intermediate companies beneath the frontier do not each need a duplicate “current ownership and control” request.

---

# 4. Need generation by requirement

## R01 — ultimate economic ownership

Generate:

- one frontier ownership need for an unresolved material corporate holder;
- relationship percentage/currentness need where that edge blocks calculation;
- same-person identity need where aggregation cannot be determined.

Do not generate one R01 need per reverse-reachable intermediary.

## R02 — indirect calculation

Generate only for the blocking edge/value/cycle needed for the active calculation.

## R03 — intermediate entity/relationship evidence

Generate separate needs for:

- entity existence;
- relationship proof;
- currentness;
- required corroboration.

Coalesce where one structure-evidence action can cover several edges.

## R04 — voting

At the customer: subject-level voting assessment.

At intermediaries: only on a relied attribution/control frontier or positive signal.

## R05/R06

Generate subject-level or positive-signal/review needs; not universal intermediary needs.

## R07

One missing-attribute need per qualifying person, with coalesced customer collection.

## R08

One subject/structure-level corroboration need, with linked relationships, not one need per extracted fact.

## R09

Primarily comparison/review output. Do not generate customer work merely because methods legitimately differ.

## R10

Review/exhaustion and preparatory SMO needs only under approved fallback preconditions.

## R11/R12

Positive signals stay separate. Negative legs may be grouped into the residual confirmation bundle after sign-off.

---

# 5. Need states

Minimum states:

- OPEN;
- SATISFIED;
- SUPERSEDED;
- REVIEW_REQUIRED;
- BLOCKED_OPERATIONALLY;
- SPECIALIST.

Historical needs remain reconstructable.

A provider outage does not transform an evidential need into a negative conclusion.

---

# 6. Need identity and deduplication

Semantic identity should include:

- case;
- target kind and canonical target;
- concept;
- dimension/relationship;
- temporal scope;
- policy requirement set;
- active policy version;
- causal edge/frontier.

One missing HoldCo ownership frontier may support R01, R02 and R03 without three customer questions.

Do not merge distinct needs merely because they concern the same entity.

---

# 7. Need versus diagnostic

A path diagnostic says:

> This calculation is affected by need X.

It is not another unresolved item.

Lab counts must distinguish:

- causal open needs;
- affected paths/calculations;
- customer work items.

The same need must not appear twice as “need” and “unresolved path”.

---

# 8. Resolution sources

A need may be resolved by:

- existing facts/evidence;
- Discovery;
- Extraction from an already-held artifact;
- customer structured input;
- customer attestation where allowed;
- targeted document/structure evidence;
- analyst/compliance review;
- specialist route;
- permitted terminal policy outcome.

The need itself does not choose the source.

---

# 9. Resolution planning waves

Use:

1. ALREADY RESOLVED;
2. SYSTEM / zero-customer-friction;
3. CUSTOMER;
4. INTERNAL/SPECIALIST;
5. TERMINAL.

Re-evaluate after each material wave.

Do not pre-generate customer questions that system actions may eliminate.

---

# 10. Structure acquisition strategy

## DISCOVERY_LED

Continue when capability profiles indicate material frontier facts are reasonably obtainable.

## CHART_ASSISTED

Pivot when:

- a material frontier is predictably opaque;
- several missing relationships share one structural cause;
- expected customer interaction count exceeds one structure-evidence request plus residual items;
- repeated normal substantive outcomes show poor coverage;
- cross-border/entity-type access predicts failure;
- customer already provides structure evidence.

## SPECIALIST

Use where ordinary deterministic handling cannot safely resolve the structure.

---

# 11. RegistryCapabilityProfile

Maintain outside the legal Policy Pack.

Conceptual fields:

- profile ID/version/hash;
- provider/entitlement context;
- jurisdiction;
- entity type;
- identity availability;
- direct ownership availability;
- exact versus banded values;
- voting/control availability;
- filing availability;
- private/public access;
- freshness/retrieval characteristics;
- operational support state.

Planner decisions using it are pinned in the snapshot.

---

# 12. Predictive pivot

Do not require failed paid searches before asking for structure evidence where opacity is already predictable.

Example:

- first frontier is an entity type/jurisdiction for which configured providers cannot obtain shareholder details;
- recommend chart/structure evidence immediately;
- continue independent verification for every accessible relationship after chart extraction.

Do not hard-code jurisdiction stereotypes into core policy.

---

# 13. Needs collapse

Several needs sharing one structural cause become one action bundle.

Example:

A missing governance document could support:

- voting;
- appointment/removal;
- other control.

Produce one targeted governance-evidence action with three linked needs.

Do not create three uploads.

---

# 14. Customer-action gating

A need becomes customer work only where:

- it remains material after zero-friction actions;
- customer input is policy-permitted;
- the current plan selects a customer route;
- no specialist stop supersedes it;
- wording/submission contract is approved.

Operational failure alone never creates customer work.

---

# 15. Customer structured action types

Possible customer actions:

- confirm established structure;
- correct a specific relationship;
- supply a missing direct holder;
- supply exact/range/unknown percentage;
- supply missing identity attributes;
- answer a last-resort gated control question;
- provide structure evidence;
- provide targeted relationship/governance evidence;
- separate residual attestations in one bundle;
- delegate a bundle to an authorised knowledgeable person.

No universal free-text ownership answer as authoritative structure.

---

# 16. Chart-assisted flow

1. request current structure evidence with as-at date;
2. Evidence Platform extracts candidate entities/relationships;
3. UBO validates and adjudicates candidate facts;
4. Discovery independently verifies accessible material edges;
5. evidence state is recorded per edge;
6. unresolved causal frontier/edge needs remain;
7. customer receives one batched residual request;
8. re-evaluate and snapshot.

The chart never becomes operative truth by upload alone.

---

# 17. Evidence states

Use edge/support states:

- VERIFIED;
- CORROBORATED;
- DECLARED;
- CONTRADICTED;
- STALE;
- UNKNOWN.

These are not claim states and not whole-entity states.

A relationship can be established but only declared; another can be contradicted; an entity itself can still be identified.

---

# 18. ASDA intended need shape

Do not hard-code exact counts.

Expected causal categories:

- one TDR/Capital LLP governance/control frontier;
- edge-level currentness/percentage needs only where genuinely missing and decision-sensitive;
- one structure-level corroboration need if not already satisfied;
- separate residual statements bundled into one interaction;
- review/specialist state where LLP/joint-control interpretation requires it.

Prohibited:

- R01 need for every intermediary;
- R04 need for every intermediary;
- duplicate listing of each affected path as another unresolved item;
- automatic 18-question customer plan.

---

# 19. Planner explanation

Every recommendation must explain:

- the causal need(s);
- why the route is permitted;
- why it is current;
- why a lower-friction route is unavailable/exhausted;
- what outcome is expected;
- what triggers re-evaluation.

No opaque friction score in v1.

---

# 20. Finish-line UX

Customer-facing projection may state:

> We verified 9 of 11 material relationships. We need 2 items.

Counts must be causal/customer work counts, not affected-path counts.

---

# 21. Delegation

A customer bundle may be delegated to an authorised person such as:

- CFO;
- company secretary;
- legal adviser;
- accountant;
- ownership/finance contact.

Capture who answered, capacity and as-at date.

Delegation is a host/journey action; UBO retains the actor/capacity provenance.

---

# 22. Attempt awareness

Do not repeat unchanged substantive attempts that returned:

- NO_DATA;
- UNSUPPORTED;
- final INCONCLUSIVE.

Retry operational UNAVAILABLE/FAILED only under explicit retry semantics.

A material state/capability/profile change may justify a new attempt.

---

# 23. Safe failure

If no route can proceed:

- INTERNAL_REVIEW;
- SPECIALIST;
- UNRESOLVABLE;
- CDD_FAILURE;
- fallback candidate,

according to policy.

Do not loop or ask the customer everything.
