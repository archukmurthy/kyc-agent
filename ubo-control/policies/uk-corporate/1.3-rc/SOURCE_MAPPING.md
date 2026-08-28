# UK Corporate 1.3-RC source-to-runtime mapping

## Artifact identity

| Field | Value |
|---|---|
| Control Room source | `ubo-policy-pack.uk-corporate.v1.3-RC.control-room-source.json` |
| Source SHA-256 | `sha256:921355c9d4e7a170156c8adff7e9a272a36daf9d63ca5d1352363f5139483b3b` |
| Source schema version | `1.0` |
| Source policy version | `1.3-RC` |
| Supersedes | `1.2-RC` |
| Source readiness | `CONTROL_ROOM_REVIEW` |
| Runtime artifact | `policies/uk-corporate/1.3-rc/policy.json` |
| Runtime canonical hash | `sha256:6bb687ae0c65de7063473db7d34c4f693279dafdd7ef293c79d22347aab29496` |

The source file is authoritative source material, not the runtime artifact. The runtime hash is over `ubo-canonical-json-v1`; it is intentionally different from the source-file byte hash.

## Ownership classification

| Classification | Content |
|---|---|
| Runtime Policy Pack data | Jurisdiction/applicability; effective period; entity profiles; parameters; definitions; requirements; evidence model/catalogue; role projection; information-need policy; terminal outcomes; lifecycle checkpoint metadata; semantic action templates; source traceability |
| Engine/schema contract | Capability outcomes; requirement and claim states; applicability truth values; resolution strategies/effects; risk levels; condition-language syntax and missing-value semantics; canonicalization; candidate-fact-before-conclusion rules |
| Architecture governance | Standalone dependency direction; Evidence Platform boundary; candidate facts do not mutate a graph; operational failure is not absence; engine/host I/O boundaries |
| Future host/journey integration | Form/session/UI presentation, application route IDs, event subscriptions, checkpoint invocation, persistence, and onboarding workflow wiring |

The runtime pack pins engine contract versions in `engineSemantics`; it does not copy or redefine those vocabularies as tenant policy data.

## Mechanical transformations

- Source snake-case container fields are normalized to the existing runtime camel-case convention.
- Requirement `id` becomes `requirementId`; source IDs and compliance text otherwise retain their meaning.
- Source provenance and revision notes are retained under `sourceTraceability`.
- Source B-codes remain `sourceReference` traceability values. Durable runtime action identifiers are semantic `actionTemplateId` values.
- Source `runtime_contract`, conventions that define engine meaning, host presentation labels, and architecture-only invariants are excluded from runtime policy data and governed by architecture/ADRs/tests.
- The 22 supplied behavioral assertions are preserved one-for-one in `test-assertion-plan.json`; none is represented as already behaviorally implemented by schema validation.

No compliance threshold, condition, requirement, evidence rule, resolution option, terminal outcome, or supplied action wording was invented or changed by this mapping.

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
