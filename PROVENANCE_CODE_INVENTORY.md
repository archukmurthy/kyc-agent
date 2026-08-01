# Provenance Code Inventory

Date: 2026-07-27. This inventory distinguishes active behavior from schema or lab surfaces.

## Frontend capture and display

| Path / range | Function or state | Provenance role | Status |
|---|---|---|---|
| `src/App.js:425` | `fieldMetadata` | browser scalar metadata | Confirmed, not submitted |
| `src/App.js:1225-1522` | research normalization | source URL/tier/status/time/method/confidence | Confirmed |
| `src/App.js:2368-2604` | submission construction | applicant provenance, final metadata, API payload | Partial |
| `src/App.js:3310-3569` | `metaFor`, source badges | source/timestamp presentation | Confirmed |
| `src/App.js:5865-6076` | upload/dossier save | Blob URLs and dossier snapshot | Partial |
| `src/workflows/applicantWorkflow.js:34-183` | candidates/provenance | accepted/overridden/provided lineage | Confirmed |
| `src/workflows/documentWorkflow.js:45-106` | extraction mapping | document-tier extracted rows | Confirmed |
| `src/components/dossier/DossierSection.jsx:39-43` | source link | dossier source display | Confirmed |
| `src/components/changeDialogue/*` | dialogue/event builder | customer intent and policy decision | Confirmed |

## APIs and persistence

| Path / range | Data written | Assessment |
|---|---|---|
| `api/research.js` + `lib/researchCache.js:27-92` | full cached research JSON/model/time | Partial: query cache, not evidence ledger |
| `api/save-dossier.js:53-139` | tiered data, stakeholders, documents, raw research | Partial snapshot |
| `api/get-dossier.js:27-83` | restores dossier data | Confirmed read |
| `api/submit.js:72-278` | journey, completion, declaration, usage, provenance | Partial; scalar metadata gap |
| `api/submit.js:320-570` | session, fields, overrides, journey model | Partial/non-atomic |
| `api/upload-document.js:38-61` | Vercel Blob bytes, URL returned | Partial; no DB provenance/fingerprint |
| `api/change-events.js:18-47` | append-only change event | Confirmed |
| `api/amendment-documents.js` | derived document requirements | Partial remediation read |
| `api/dossier-reseed.js` | re-research/dossier transition | Partial change workflow |

## Database model

| Migration | Relevant objects | Usage |
|---|---|---|
| `003_persistence_now.sql` | journeys, events, field_provenance, documents metadata, policy_decisions, declaration, usage | Mixed: field provenance active; several objects unused by current paths |
| `004_session_timeline_fix.sql` | applicant override timeline support | Active |
| `005_entity_dossiers.sql` | analyst dossier snapshots | Active |
| `006_research_cache.sql` | cached research | Active |
| `007_change_events.sql` | immutable customer changes | Active |
| `008_dossier_research_metadata.sql` | seed actor/attempt count | Active |
| `009_ubo_investigations.sql` | immutable UBO snapshot | Active if migration deployed |

## Ownership and UBO

| Path | Role | Status |
|---|---|---|
| `agents/ubo/*OwnershipAdapter.js` | source-specific evidence/statements | Confirmed |
| `agents/ubo/documentExtractionAgent.js` | document evidence relationships | Confirmed contract |
| `agents/ubo/uboOrchestrator.js:48-110` | conflict resolution → graph → UBO | Confirmed |
| `agents/ubo/ownershipGraphBuilderAgent.js` | evidence-linked graph | Confirmed |
| `agents/ubo/evidenceResolutionAgent.js` | candidate resolution | Confirmed |
| `agents/ubo/realTimeRecalculationEngine.js:15-27` | deterministic recomputation | Confirmed |
| `agents/ubo/uboPersistence.js:8-33` | KV cache and immutable audit records | Confirmed/Partial |
| `agents/ubo/uboDatabaseAudit.js:6-25` | Neon investigation snapshot | Confirmed/Partial |
| `api/ubo-discovery.js`, `api/ubo-recalculate.js` | API entry points | Lab/feature surface |

## Validation

| Path | Role | Status |
|---|---|---|
| `agents/validation/contracts/validationTypes.js` | request/finding/result/rule context | Confirmed contract |
| `engine/validationEngine.js:33-82` | orchestrates rule-pack, extraction, validators | Confirmed |
| `engine/validatorPipeline.js:24-43` | execution context propagation | Confirmed |
| `extraction/extractionOrchestrator.js` | normalized extraction/evidence surface | Partial |
| `validators/*.js` | evidence-linked rule findings | Confirmed |
| `rulepacks/UK/loaRulePack.js`, `SG/loaRulePack.js` | versioned policy | Confirmed |
| `replay/replayHarness.js:1-3` | historical replay | Missing (explicit throw) |
| persistence route/table | durable validation execution | Missing |

## Change intelligence and RFI

| Path | Role | Status |
|---|---|---|
| `src/changeIntelligence/events/schema.js` | canonical change-event columns | Confirmed |
| `events/writeEvent.js:46-138` | sole append-only writer | Confirmed |
| `events/readEvents.js:15-99` | history/current/escalation/doc reads | Confirmed |
| `src/changeIntelligence/classifyChange.js` | deterministic workflow decision | Confirmed |
| `src/components/changeDialogue/ChangeDialogue.jsx` | customer capture | Confirmed |
| general RFI request/response/case model | remediation lineage | Missing |

## Defined-but-not-unified fields

The repository uses these overlapping concepts without a canonical cross-system schema:

- identity: field name, field ID, relationship ID, evidence ID, document ID, dossier ID, session ID, journey ID, submission ID, investigation ID, execution ID;
- source: source, source identity, source provider, source type, source tier, URL, document kind;
- time: fetched/retrieved/published/created/executed/submitted/cached;
- decision: verification status, confidence, customer action, validation status, UBO status, workflow, decided;
- version: model, prompt, validator, rule pack, pricing, cache; not all are populated.

