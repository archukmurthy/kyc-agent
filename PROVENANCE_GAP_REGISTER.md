# Provenance Gap Register

Date: 2026-07-27. Priorities reflect audit/regulatory impact, not implementation effort.

## P0 — must close before claiming end-to-end provenance

| ID | Gap | Evidence | Required outcome |
|---|---|---|---|
| P0-01 | Scalar provenance is dropped at submit boundary | `src/App.js:2536-2598`; `api/submit.js:28-33` | Transmit and persist per-field proposed value, final value, action, source/evidence IDs and times. |
| P0-02 | No canonical immutable evidence identity | browser rows, documents, UBO and validation use unrelated IDs | One evidence envelope and stable IDs referenced by every derived statement/decision. |
| P0-03 | Uploads lack fingerprint/version ledger | `api/upload-document.js:38-61` | Persist document ID, SHA-256, size, MIME, blob version/URL, uploader, timestamps and supersession. |
| P0-04 | Submission audit can silently be partial or absent | `api/submit.js:185`, `218`, `246`, `273`, `561-586` | Atomic durable record or explicit queued/reconciliation state; never report audited completion when persistence failed. |
| P0-05 | Validation decisions are not durable/replayable | `agents/validation/replay/replayHarness.js:1-3` | Store request/evidence hashes, extraction, findings, versions and final decision; implement deterministic replay. |

## P1 — high-value traceability

| ID | Gap | Required outcome |
|---|---|---|
| P1-01 | `field_provenance` is delete/reinsert snapshot | Append versions or immutable field events; derive current state. |
| P1-02 | No common correlation chain | Carry application/journey, field, evidence, document, execution and decision IDs across all APIs. |
| P1-03 | Dossier snapshots lack lineage | Version dossiers and link predecessor, source research execution and downstream journey. |
| P1-04 | No full RFI lifecycle | Model request, requested facts/docs, response evidence, analyst decision, status and closure. |
| P1-05 | UBO source configuration is inaccurately persisted | Persist actual adapters, versions, search parameters, rules and threshold pack. |
| P1-06 | Conflict handling is inconsistent | Retain all candidates and a versioned resolution decision for scalar, ownership and validation facts. |
| P1-07 | Model/prompt/version population is incomplete | Record model, prompt template/hash, extractor, validator and rule-pack versions on every derived artifact. |

## P2 — operational usability and controls

| ID | Gap | Required outcome |
|---|---|---|
| P2-01 | Taxonomies conflict | Canonical source type/tier, verification, confidence and customer-action vocabularies with adapters. |
| P2-02 | UI shows source but not lineage | Field history drawer: candidates, selected source, customer changes, validation and remediation. |
| P2-03 | Evidence location is weak | Page/region/text anchors with extraction linkage and redaction-aware rendering. |
| P2-04 | Confidence semantics are mixed | Defined scale and provenance: source reliability vs extraction confidence vs decision confidence. |
| P2-05 | Cache obscures acquisition context | Retain source snapshot identity, retrieval execution and cache-use event. |
| P2-06 | Audit completeness is not monitored | Reconciliation metrics for missing provenance, orphan evidence and failed non-fatal writes. |

## P3 — hardening and scale

| ID | Gap | Required outcome |
|---|---|---|
| P3-01 | Retention/redaction not connected to lineage | Retention policy, legal hold, erasure/redaction events without destroying audit integrity. |
| P3-02 | No cryptographic chain for audit records | Optional signed hashes/Merkle or chained event hashes for tamper evidence. |
| P3-03 | No exportable case bundle | Reproducible regulator/analyst evidence bundle with manifest and hashes. |
| P3-04 | Cross-tenant policy/version governance | Tenant-scoped provenance policy, schema version and migrations. |

## Decisions required

1. Is provenance event-sourced (recommended) or snapshot-based with history tables?
2. What is the canonical unit: field assertion, evidence item, or both linked by derivation edges?
3. Must submission block on audit persistence, or may it enter a visibly pending/reconciliation state?
4. What source-tier vocabulary and confidence scales are authoritative?
5. Which artifacts require immutable bytes versus stable external URLs?
6. What constitutes a replay: same stored inputs under old versions, or re-evaluation under a new policy?
7. Which personal data may be retained in audit records, for how long, and under what redaction rules?
8. Should dossier, journey, UBO, validation and RFI share one event store or federate through IDs?

## Recommended implementation sequence

1. Define a versioned provenance contract: `Evidence`, `Assertion`, `Derivation`, `Decision`, `ActorAction`, `ArtifactVersion`.
2. Add stable correlation/evidence/document IDs and an append-only persistence seam; preserve existing tables through adapters.
3. Close the scalar submit gap and make audit persistence observable/reconcilable.
4. Introduce document fingerprint/version persistence before expanding extraction.
5. Persist validation executions and implement replay against stored versions.
6. Normalize UBO source configuration, resolution records and rule versions into the shared contract.
7. Connect change intelligence to a full RFI/remediation lifecycle.
8. Add a lineage UI and exportable audit bundle.
9. Add cross-system contract, replay, failure and orphan-reconciliation tests.

## Acceptance gates

- Every final field resolves to one or more immutable assertions and evidence items.
- Original agent value and every customer/analyst action remain queryable.
- Every document/excerpt can be verified against a stored hash/version.
- Every automated decision names its exact code/rule/model/prompt versions.
- Replaying stored inputs under stored versions reproduces the recorded decision.
- Failure to persist provenance is visible and recoverable.
- A single application ID can enumerate research, dossier, submission, UBO, validation, changes and RFI history.

