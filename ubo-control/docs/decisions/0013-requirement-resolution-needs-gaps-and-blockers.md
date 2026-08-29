# ADR 0013: Requirement resolution, information needs, gaps, and operational blockers

- Status: Accepted
- Decision date: 2026-08-29
- Authority: UBO Control Room

## Context

G2.3 determines policy applicability and whether ownership/control bases are satisfied, not satisfied, indeterminate, or review-required. It does not decide whether supporting evidence is sufficient or explain which substantive information is still missing. Capability failures must also remain distinct from policy deficits, and missing information must not prematurely become a customer question or document request.

## Decision

G2.4A introduces a pure internal `ubo-requirement-resolution-v1` stage. Each Policy Pack requirement receives exactly one approved state using deterministic precedence: non-applicable, unknown applicability, relevant conflict, human review, resolved, substantive gap, then operational-only unresolved. The stage consumes pinned G2.2/G2.3 artifacts and never recomputes ownership arithmetic or policy qualification.

An explicit, policy-hash-pinned `EvidencePolicyClassification` maps a durable EvidenceReference to a Policy Pack catalogue key, source origin, current/freshness metadata, classification basis, and the fact/basis it supports. Independence is never inferred from upload identity. Catalogue strength and policy characteristics come only from the pack. Strengths are not additive; resolution effect, can-resolve-alone, corroboration, direction, freshness, current state, and distinct-source requirements remain independent constraints. Unmapped references are retained as unclassified rather than discarded or assigned invented strength.

An `InformationNeed` records the semantic fact or evidence condition still required, its subject/target, requiring requirements, relevant reasoning references, existing EvidenceReferences, and the unordered set of policy-permitted resolution strategies. It is not a question, document request, task, or priority decision. Equivalent subject/concept targets deduplicate across requirements. Revision records support `OPEN`, `SATISFIED`, and `SUPERSEDED` states without deleting earlier records.

A `PolicyGap` records an applicable substantive policy fact/evidence deficit and references its InformationNeeds. It contains no customer-facing remediation wording. `UNAVAILABLE` and `FAILED` capability outcomes instead create `OperationalBlocker` records; they are never negative evidence or customer PolicyGaps by themselves.

## Consequences

Requirement resolution is reproducible and auditable without importing an evidence repository, workflow engine, provider, persistence layer, or onboarding model. `UNRESOLVED` remains distinct from `GAP`, shared missing facts do not multiply into duplicate requests, and capability health cannot silently alter compliance facts.

G2.4B must separately decide option/action selection, priority, SMO fallback, discrepancy workflow, risk signals, terminal outcome, full decision snapshots, and re-resolution orchestration. This ADR does not approve the practitioner resolution-priority hypothesis.
