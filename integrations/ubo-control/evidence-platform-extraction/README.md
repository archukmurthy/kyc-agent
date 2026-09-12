# Evidence Platform extraction adapter

This UBO-owned adapter implements the existing `ExtractionService` seam for review-only G4.1 integration. It accepts references to Evidence Artifacts that already exist and invokes an already-constructed Evidence consumer. It does not upload files, ingest private material, create Artifacts, choose providers, persist Evidence, or perform UBO determination.

## Contract boundary

- The only Evidence import is the frozen public entry point at `evidence/consumer/v1/index.js`.
- The composition root must inject both an `evidenceConsumer` and a separate `trustedAuthorizationProvider`. Authorization is never inferred from a UBO request or an Artifact reference.
- One Artifact may support several distinct CandidateFacts. Those facts retain separate locators, but they still represent one independent source; fact count must not be treated as source count.
- CandidateFacts are source-backed candidates only. The adapter does not mutate the ownership graph, adjudicate claims, calculate effective interests, apply policy thresholds, or identify qualifying people.

## Outcome semantics

The adapter distinguishes facts responsive to requested UBO concepts from supplemental facts discovered by Evidence:

| Fact scope | Mapping issue | Overall extraction outcome |
|---|---|---|
| Requested | Any unsupported or invalid requested fact, or an incomplete requested concept | `PARTIAL` |
| Discovered | Unsupported supplemental fact | Issue and source material are retained, but a fully satisfied requested extraction may remain `COMPLETE` |
| Either | General Evidence, authorization, integrity, completeness, or contract failure | Fails or degrades according to the frozen consumer/ExtractionService contracts |

`OFFICER_OF` is deliberately mapped only to bounded `officer_relationship` entity-attribute metadata. It is not economic ownership, voting rights, formal control, or evidence of qualification. If officer information is explicitly requested and cannot be mapped, it blocks completeness like any other requested concept.

An Evidence relationship may carry the explicit public qualification `economic_interest_concept:SHARE_OWNERSHIP`. The adapter preserves that exact source qualification as the UBO `economicInterestConcept`; it does not infer company shares from a generic economic relationship or alter percentage arithmetic.

## Deliberately unimplemented

Trusted private Artifact ingestion and host composition remain separate future work. This adapter cannot accept bytes, Blob URLs or filesystem paths, and it cannot fabricate Artifact IDs. Evidence Core and its public contract are unchanged; UBO core contracts, policy packs and sign-off statuses are unchanged; production remains unauthorized.
