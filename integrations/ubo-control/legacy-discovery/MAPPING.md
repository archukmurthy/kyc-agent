# Legacy Discovery anti-corruption mapping

This disposable host integration implements the public `DiscoveryService` shape by translating the existing `POST /api/ubo-discovery` capability. It is not an ownership determination and does not make legacy UBO conclusions authoritative in UBO Control.

G3.2 adds an actual HTTP transport and one composition point: `createLegacyDiscoveryComposition({ baseUrl, policyPack, fetchImpl?, timeoutMs? })`. The configured HTTP base URL is infrastructure input; no hostname, credential, provider model, search budget or cache setting enters UBO Control. The composition returns the adapter as `discoveryService` and the public stateless decision façade as `decisionApplication`. It imports no legacy endpoint implementation.

## Request mapping

The adapter validates the public Discovery request and sends only:

| Discovery request | Legacy request |
|---|---|
| `subject.name` | `entityName` |
| `subject.jurisdiction` | `jurisdiction` |
| an explicitly supplied company-registration external identifier | `registrationNumber` |

It sends no UBO threshold, discovery-materiality threshold, tenant/provider selector, cache instruction, credential, Policy Pack field or canonical UBO entity ID. A non-corporate subject, missing name/jurisdiction or unrelated InformationNeed is `UNSUPPORTED` without invoking transport.

## Safe output mappings

Only direct source relationship material retained on `ownershipGraph.edges`, its endpoint identity assertions and its specifically referenced evidence entries are considered. Edge direction is normalized as legacy `from` owner/controller to legacy `to` owned/controlled entity, yielding grammatical `subject relationship object` facts.

- an explicit ownership edge without contradictory nature metadata becomes `ECONOMIC_OWNERSHIP`;
- explicit `ownership-of-shares-*` nature becomes `ECONOMIC_OWNERSHIP` with the explicit `SHARE_OWNERSHIP` policy concept;
- explicit `voting-rights-*` nature becomes `VOTING_RIGHTS` with the explicit `VOTING_RIGHTS` policy concept;
- explicit appointment/removal or significant-influence nature becomes the corresponding provider-neutral control relationship;
- trust-role relationship types are retained only where the legacy type is explicit;
- a legal-entity registration number becomes a candidate external identifier, never a canonical UBO entity ID;
- distinct legacy edge rows remain distinct candidate assertions.

An exact scalar becomes `EXACT` only where the legacy assertion represents an exact value. A reconstructable Companies House band such as `ownership-of-shares-25-to-50-percent` becomes `RANGE` with its preserved lower/upper semantics. A lower bound whose upper-bound semantics were lost becomes `UNKNOWN` plus `LEGACY_PERCENTAGE_PRECISION_LOSS`; it never becomes an exact percentage. Collapsed ownership/voting semantics are omitted with `LEGACY_AMBIGUOUS_RELATIONSHIP_SEMANTICS`.

## Intentionally ignored legacy conclusions

The adapter never reads legacy `ubos`, effective ownership, threshold result, control conclusion, confidence score, stakeholder projection, ownership gaps/remediation, reviewer presentation, cached determination metadata, explanations, resolution decisions or final status as fresh UBO conclusions. Changing those fields while source edges/evidence remain fixed cannot change the DiscoveryService result.

## Outcome mapping

| Condition | Outcome |
|---|---|
| useful safe candidates, but non-exhaustive legacy coverage | `PARTIAL` |
| normal success with no usable candidate information | `NO_DATA` |
| candidate-like material exists but cannot be translated safely | `INCONCLUSIVE` |
| subject/InformationNeed cannot be represented | `UNSUPPORTED` |
| timeout, connection failure, 5xx, rate limit, authentication/configuration/dependency failure | `UNAVAILABLE` |
| malformed response/envelope or unexpected non-availability HTTP rejection | `FAILED` |

`COMPLETE` is deliberately not emitted. The existing capability cannot prove exhaustive current ownership and control.

## Evidence boundary

Fact-level references are created only from the specific legacy evidence IDs attached to that edge. Source name, URL and publication date are retained as an opaque locator only when supplied. Run/audit IDs are operation-level references and are never copied onto every fact. The adapter invents no Artifact ID, Fact ID, hash, page locator, integrity guarantee or Evidence Platform provenance. A candidate without a durable source reference remains visible with `LEGACY_MISSING_DURABLE_EVIDENCE_REFERENCE`.

## Known lossiness

The adapter cannot repair information already discarded upstream. Known limitations include ceased PSCs filtered before the response, unrecognized/non-band PSC data potentially dropped, voting/economic semantics sometimes collapsed, percentage ranges sometimes reduced to lower bounds, raw Companies House payloads not durably retained, incomplete PSC pagination, pre-adapter conflict resolution/deduplication, threshold/materiality filtering and provenance weaker than Evidence Platform provenance. These limitations produce stable integration issues and conservative outcomes; they do not become PolicyGaps automatically.

The integration is disposable because production code inside `ubo-control/` never imports it. A later evidence-backed Discovery implementation can replace it at host composition without changing UBO Control.

## Deterministic and live verification

Ordinary tests use an injected `fetch` boundary and never require a network or credential. E2E-D1 through E2E-D4 prove direct exact ownership, multilayer look-through, unresolved branches and voting/economic separation through adapter → public decision façade → fresh `DecisionSnapshot`. A polluted legacy `ubos`/threshold result cannot alter fresh snapshot semantics.

`npm run verify:live` is separately opt-in. It requires `UBO_LEGACY_BASE_URL`, `UBO_POLICY_PACK_PATH`, `UBO_LIVE_ENTITY_NAME`, and optional subject fields. The first run performs real discovery and reports stable decision targets. It does not evaluate until an operator reviews them and supplies `UBO_LIVE_DECISION_PLAN_PATH` containing explicit entity registrations, identity decisions and claim adjudications. A live failure is reported as failure; the verifier never falls back to fixtures. Reports summarize outcomes, fresh fingerprints/calculations/policy/hash and omit the raw provider payload.
