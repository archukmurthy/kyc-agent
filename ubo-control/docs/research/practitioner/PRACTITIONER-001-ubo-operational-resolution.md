# PRACTITIONER-001 — UBO operational resolution

| Metadata | Value |
|---|---|
| ID | `PRACTITIONER-001` |
| Classification | `PRACTITIONER_EVIDENCE` |
| Authority | `NON_POLICY` |
| Architecture change | `NONE` |
| Policy change | `NONE` |
| Contract change | `NONE` |
| Primary future gate | Gate 5 — Journey Design |
| Status | `RECORDED` |

## Authority and use

This record captures operational practitioner context supplied to the UBO Control Room. It informs product and journey hypotheses for later gates; it does not approve implementation behavior.

> Practitioner evidence informs product/journey hypotheses. It is not regulatory authority and may not independently amend Policy Packs, deterministic UBO rules, capability contracts, fallback eligibility or Evidence/UBO boundaries.

The observations below must not be reinterpreted as policy. In particular, this record does not change the UK Corporate Policy Pack, any deterministic UBO calculation or decision, the DiscoveryService or ExtractionService contracts, or the ownership boundary between UBO Control and Evidence Platform.

## Operational observations

### Resolve facts before asking customers

Customer questions create avoidable friction when the relevant policy requirement has already been resolved to the required evidential standard. Journey design should therefore test whether a required fact or InformationNeed is already resolved before presenting a question. Suppressing a question does not suppress or amend the underlying requirement.

### Request governance documents for a purpose

Articles, shareholder agreements, LLP agreements and similar governance documents are most useful when requested to resolve a specific outstanding InformationNeed. They should not automatically become universal checklist items. Applicable policy continues to determine whether a document is sufficient, current, certified or otherwise acceptable.

### Treat ownership charts cautiously

A customer ownership chart is normally a candidate description and navigation aid. It should not automatically be treated as independently corroborative evidence. Only applicable policy can determine whether a chart provides sufficient proof for a particular requirement.

### Progressively disclose control complexity

The engine must be capable of representing ownership, voting rights, appointment rights, share-class effects and other significant-control routes. The customer journey need not expose every possible question in every case. Those questions should appear only when case state and policy make them necessary: capability breadth must not become questionnaire breadth.

### Organise resolution around required facts

Operational resolution is better framed around unresolved required facts or InformationNeeds than around completion of a document checklist:

```text
Policy requires Fact X
→ already established?
→ Discovery?
→ already-held evidence/extraction?
→ permitted lightweight response?
→ targeted evidence request?
→ analyst/specialist?
```

A document may support multiple requirements, and each resulting candidate fact must be considered independently.

### Candidate resolution priority

The practitioner context proposes this order for later journey-design consideration:

1. existing facts/evidence;
2. Discovery;
3. extraction from already-held artifacts;
4. permitted lightweight customer response;
5. targeted customer evidence/document request;
6. analyst/specialist review;
7. applicable terminal policy outcome.

This is a hypothesis, not approved execution logic. It must not be implemented as generic resolution logic unless the Control Room explicitly approves it in a future gate.

### Treat source availability as dynamic

Registry and source availability can vary at runtime. Journey and resolution design should consume the actual capability outcome rather than assume that availability is a static jurisdiction property. Rules such as `UK = available` or `Netherlands = unavailable` must not be encoded from this evidence.

## SMO fallback warning

> No shareholder above the ownership threshold is NOT equivalent to SMO fallback eligibility.

SMO fallback remains governed by the approved Policy Pack and later deterministic policy reasoning. `NO_DATA` from Discovery may never trigger fallback. This practitioner evidence does not amend R10.

The distinction matters operationally: absence of discovered threshold ownership is a capability or case-state observation, while fallback eligibility is a policy conclusion that may depend on additional requirements and evidence.

## Document/fact distinction

> `Document checked = YES` is not a UBO resolution state.

A single artifact may generate candidate facts that independently affect several requirements:

```text
Articles interpreted
      ↓
candidate voting fact
candidate appointment-right fact
candidate other-control fact
      ↓
R04, R05 and R06 evaluated separately
```

This record does not implement or approve that evaluation. It preserves the product hypothesis that artifacts are sources of candidate facts, not coarse-grained substitutes for requirement resolution.

## Practitioner research backlog

The following questions remain research questions. They are not policy propositions, architecture decisions, acceptance criteria or implementation requirements.

1. What evidential standard must be visible to journey orchestration before a customer question may be suppressed, and how should a later loss or challenge of that evidence reopen the need?
2. Which governance artifacts most often resolve ownership, voting, appointment-right, share-class or other-control gaps, and where do certification or recency expectations differ?
3. When, if ever, may an ownership chart provide sufficient proof rather than navigation or declaration only?
4. Which case signals should progressively reveal voting, appointment-right, share-class and significant-control questions without hiding genuinely required questions?
5. Which InformationNeeds may be resolved by a lightweight customer response, and which always require targeted evidence or specialist review?
6. How should the proposed candidate resolution priority vary when policy, source reliability, evidence age, conflicts or runtime capability availability differ?
7. How should runtime registry/source availability, partial results and operational failures be communicated to journey orchestration without treating `NO_DATA` as a policy conclusion?
8. What operational signals help distinguish a case with no discovered threshold owner from a case that is eligible for SMO fallback under the approved Policy Pack?
9. How should candidate facts extracted from one artifact be presented and reviewed when they affect multiple requirements independently?

These questions require further practitioner and policy-authority research in the applicable future gates.
