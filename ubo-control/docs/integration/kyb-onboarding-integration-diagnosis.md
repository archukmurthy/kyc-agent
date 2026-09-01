# KYB onboarding integration diagnosis

Status: **ACCEPTED DIAGNOSIS**
Implementation: **DEFERRED UNTIL AFTER UBO CONTROL LAB VALIDATION**

This is non-runtime integration input. It does not authorize changes to the KYB onboarding application.

## Recommended insertion point

Create the UBO case only after company/registration selection has stabilized legal name, registration identifier, jurisdiction and entity profile. Run the host adapter and UBO Discovery composition after that identity checkpoint and before ownership/customer-gap/document/declaration stages consume ownership conclusions. The host should pass public capability results into Decision Application intake, apply only approved explicit or deterministic identity and claim decisions, evaluate, then render public graph/journey/plan projections.

## Existing overlap and migration

The current research/stakeholder surfaces overlap UBO Discovery, ownership percentages, control questions, stakeholder confirmation, Fill Gaps and Required Documents. During migration they remain host concerns behind a feature flag; they must not be converted wholesale into OwnershipCase or treated as authoritative UBO claims. The adapter translates only stable subject context and approved capability/customer contracts. UBO projections should gradually replace duplicated ownership/control presentation, while unrelated applicant and account data stays in the host.

## Persistence and analyst seam

Persist sealed Decision Application state, immutable DecisionSnapshots and public projections as UBO-owned records keyed by stable host references. Do not store customer journey progress in `entity_dossiers`, and do not rebuild claims from host form state. Candidate-party identity and candidate-claim adjudication targets require a dedicated analyst/compliance seam; unresolved targets must not be hidden to keep onboarding smooth.

## Feature-flag strategy

Introduce UBO Control as an opt-in tenant/journey feature after Lab acceptance. Run legacy and UBO paths side by side for controlled comparison, but designate only one authority per surfaced decision. Rollback disables the UBO consumer path without rewriting sealed UBO history. Dossier/invite restoration must restore UBO references/state rather than infer it again from stakeholder names.

## Evidence convergence

The convergence point is the provider-neutral external evidence handoff: customer journey → `EXTERNAL_EVIDENCE_REQUIRED` → future Artifact → ExtractionService → candidate facts → Decision Application intake → explicit decisions → evaluate. Uploading a file never resolves ownership. Gate 4 prerequisites and Lab validation precede onboarding integration.

## Major boundary risks

- duplicated ownership logic between host stakeholder state and UBO Control;
- names, DOB or legacy/provider node IDs used as identity keys;
- PARTIAL/NO_DATA Discovery treated as operative or negative evidence;
- customer statements or uploads treated as automatically established facts;
- mutable customer progress stored in analyst dossiers;
- UBO core coupled to React, host APIs, routes, database schemas or Evidence types;
- stale projections/actions updating a newer case revision;
- dual running without an explicit authority and rollback rule.
