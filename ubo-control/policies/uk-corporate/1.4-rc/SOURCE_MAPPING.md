# UK Corporate 1.4-RC source-to-runtime mapping

## Artifact identity

| Field | Value |
|---|---|
| Control Room source | `Control Room — Revised G2.4B Decision: Asynchronous Fallback Review` |
| Source SHA-256 | `sha256:6b82ee31fc7f1811b0fdbaf75ca2ee0c70bf958f1a505ce3ad239c2ed103d94f` |
| Source schema version | `1.1` |
| Source policy version | `1.4-RC` |
| Supersedes | `1.3-RC` |
| Source readiness | `CONTROL_ROOM_REVIEW` |
| Runtime artifact | `policies/uk-corporate/1.4-rc/policy.json` |
| Runtime canonical hash | `sha256:43e1ce72f884d626a4962351a44c7305117c6b12d6e398ca1ebb4ca46813a87a` |

The source file is authoritative source material, not the runtime artifact. The runtime hash is over `ubo-canonical-json-v1`; it is intentionally different from the source-file byte hash.

## Ownership classification

| Classification | Content |
|---|---|
| Runtime Policy Pack data | Jurisdiction/applicability; effective period; entity profiles; parameters; definitions; requirements; evidence model/catalogue; role projection; information-need policy; asynchronous fallback-review policy; terminal orchestration policy; terminal outcomes; lifecycle checkpoint metadata; semantic action templates; source traceability |
| Engine/schema contract | Capability outcomes; requirement and claim states; applicability truth values; resolution strategies/effects; risk levels; condition-language syntax and missing-value semantics; canonicalization; candidate-fact-before-conclusion rules |
| Architecture governance | Standalone dependency direction; Evidence Platform boundary; candidate facts do not mutate a graph; operational failure is not absence; engine/host I/O boundaries |
| Future host/journey integration | Form/session/UI presentation, application route IDs, event subscriptions, checkpoint invocation, persistence, and onboarding workflow wiring |

The runtime pack pins engine contract versions in `engineSemantics`; it does not copy or redefine those vocabularies as tenant policy data.

## Mechanical transformations

- Source snake-case container fields are normalized to the existing runtime camel-case convention.
- Requirement `id` becomes `requirementId`; source IDs and compliance text otherwise retain their meaning.
- Source provenance and revision notes are retained under `sourceTraceability`.
- Historical `1.3-RC` remains byte-for-byte unchanged; `1.4-RC` is a separate schema-`1.1` successor.
- The Control Room-approved asynchronous fallback-review semantics are represented declaratively in `fallbackReviewPolicy` and `resolutionOrchestrationPolicy`.
- Existing supplied B10 wording is retained under semantic action ID `IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES`; its approved pre-review timing replaces the prior post-eligibility timing.
- Source B-codes remain `sourceReference` traceability values. Durable runtime action identifiers are semantic `actionTemplateId` values.
- Source `runtime_contract`, conventions that define engine meaning, host presentation labels, and architecture-only invariants are excluded from runtime policy data and governed by architecture/ADRs/tests.
- The 22 behavioral assertions remain one-for-one in `test-assertion-plan.json`; the R10 measures-record assertion is updated from a future full snapshot to the approved G2.4B review package and exhaustion decision.

No compliance threshold, evidence acceptance rule, reviewer authority, action priority, terminal outcome, or customer wording was invented by this mapping.

## Explicit unresolved source references

| Kind | Semantic runtime reference | Source reference | Reason |
|---|---|---|---|
| Action template | `DISCLOSE_SHARE_OWNERSHIP` | `B1` | Full source template text was not supplied |
| Action template | `CAPTURE_QUALIFYING_PERSON_IDENTITY` | `B1` | R07 references B1 for missing identity attributes; exact interaction wording was not supplied |
| Action template | `DISCLOSE_TRUST_IN_CHAIN` | `B2` | Full source template text was not supplied |
| Action template | `DISCLOSE_OTHER_SIGNIFICANT_CONTROL` | `B4` | Full source template text was not supplied |
| Lifecycle event | — | `E01` | No source event catalogue definition was supplied |
| Lifecycle event | — | `E02` | No source event catalogue definition was supplied |
| Lifecycle event | — | `E08` | No source event catalogue definition was supplied |
| Lifecycle event | — | `E10` | No source event catalogue definition was supplied |

Unresolved references must be replaced only by later Control Room-approved source material. They must not be silently mapped to host identifiers or filled with inferred wording.
