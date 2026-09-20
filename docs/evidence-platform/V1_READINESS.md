# Evidence Platform Core V1 — Closure and Readiness

**Audit date:** 8 September 2026

**Audited branch:** `feature/evidence-platform`

**Accepted implementation through:** `c55354aeb334c7c99201ade7a5b3d96e030d3266`

**Scope:** Evidence Core only; no KYC, UBO, IDV, producer-control-room, or Case Explanation integration is implied.

| Closure identifier | Status |
|---|---|
| `implementationBaselineSha` | `4602d763bd728f36b16de335cdd85cd6abced55d` |
| `consumerFacadeGovernanceSha` | `9d8ba6fbd808b1306b628371867f3e68b43485ea` |
| `consumerFacadeImplementationSha` | `c55354aeb334c7c99201ade7a5b3d96e030d3266` |
| `contractFreezeSha` | `c55354aeb334c7c99201ade7a5b3d96e030d3266` |
| `closureDocumentationSha` | Pending until this closure-documentation commit is created |
| `mainMergeSha` | Absent |
| PR numbers | None |
| Push status | Not pushed |

## Verdict

```text
Evidence Core V1 architecture: COMPLETE
Evidence V1 in-process public consumer contract: FROZEN
```

| Question | Verdict | Meaning |
|---|---|---|
| Evidence Core V1 architecture | **COMPLETE** | The approved independent Evidence lifecycle is implemented from acquisition/ingestion through immutable package, with provenance and non-decision boundaries intact. |
| Controlled pilot readiness | **READY WITH BLOCKERS** | A trusted host integration and the minimum security/operational gates below are required before real-user or customer-document pilot traffic. |
| Production readiness | **NOT READY** | The Lab routes are not production contracts and production authentication, operations, security, quality governance, and lifecycle controls remain incomplete. |

Evidence Core V1 is **CLOSED / MAINTENANCE**. No additional Evidence Core domain stage is required to close V1. Remaining work belongs to governed contract maintenance, producer/consumer integration, operational readiness, and measured quality.

## Accepted capability inventory

| Stage | Accepted contribution | Status |
|---|---|---|
| A0 | Isolated `evidence/` server boundary, status route, and Evidence Lab | Implemented and accepted; Lab scaffold |
| A1 | Requirements, Information Needs, subjects/contexts, Acquisitions, Assets, Artifacts, access scopes, extraction lineage, and public/private invariants | Implemented and accepted; internal Evidence core |
| A2 | Producer-neutral collection-operation identity plus the Companies House producer: three API and three website acquisitions, pagination, partial outcomes, deterministic extraction, immutable recollection, and historical reopen | Implemented and accepted; Companies House adapter is source-specific |
| A3 | Requested/discovered and direct/derived Facts, support states, verification/derivation lineage, multi-Artifact same-Asset interpretation, provider/model/instruction lineage, and append-only history | Implemented and accepted; internal interpretation core |
| A4a | Immutable Fact-to-Information-Need evaluation using exact typed, conservative normalized, or provider-neutral semantic methods; no winner or satisfaction | Implemented and accepted; internal evaluation core |
| R1 | Generic private PDF/PNG/JPEG ingestion and authorized byte-exact reopen using existing Artifact/storage/access primitives | Implemented and accepted; **PROVISIONAL** service candidate with **LAB ONLY** HTTP adapter |
| R2 | Provider-neutral targeted interpretation request, operation idempotency, authorized options/preflight, explicit execution, and no-provider history | Implemented and accepted; **PROVISIONAL** service candidate requiring trusted host authorization |
| R3 | PDF/image interpretation within explicit limits plus durable Fact-to-Artifact locators; no fabricated image coordinates | Implemented and accepted; internal multimodal extension |
| R4 | Typed subject–relationship–object Facts with exact/range/qualitative/unknown measures, temporal state, parties, and locator lineage | Implemented and accepted; internal relational extension |
| A4b | Provisional coverage, collection completeness, legitimate-empty-set, comparable-disagreement, temporal-applicability, and limitation dimensions | Implemented and accepted; internal assessment core; no KYC decision |
| A5a | Authorized deterministic point-in-time reconstruction over canonical Evidence records, including known availability limitations | Implemented and accepted; internal read service and Lab-only HTTP adapter |
| A5b | Immutable canonical Evidence Packages with ordered canonical membership, separate manifest SHA-256, member-level authorization, reopen, and verification | Implemented and accepted; internal service and Lab-only HTTP adapter |
| V1 consumer façade | One versioned in-process import with bounded authorization/request/result/error DTOs over accepted R2, A5a, and A5b services | Implemented and accepted at `c55354aeb334c7c99201ade7a5b3d96e030d3266`; **FROZEN** |

### Accepted commit inventory

The Evidence branch was built from inspected base `454a04075f12d119efec88ddc5458dcf57a74aba`. The accepted governance and implementation sequence is:

| Commit | Accepted change |
|---|---|
| `8f86b478bd3ad5a44f6563d815fff853fe22de5f` | Governance baseline |
| `f70ce2021bcfd5a8920eb4356cfa25eca438b374` | Independent-platform build strategy |
| `823e898c8883c06dcb6f7b1e09eca7d2d9539c43` | A0 platform boundary and Evidence Lab |
| `02aca91ec13123a6057c526de066e070fd7d9161` | A1 governance authorization |
| `3ae846e1242595d4d71348993355731349a72ae5` | A1 core Evidence domain and lineage |
| `14ea48d885b3af869b1508c64f359cd1327171e9` | A2 Companies House governance authorization |
| `061ce1e9cf5b2a4bf4a606b9cbf052fb3bb7b6f4` | A2 human-viewable-capture governance expansion |
| `058a6ee76dd1436969de84c2b926f08f582898b7` | A2 Companies House producer |
| `cfac09ad46662e6606fd5984e1004800ecc4bbd2` | A3 interpretation governance authorization |
| `ff972bd0db0bf21937571c2a71b2a676460638f9` | A3 live-Artifact governance authorization |
| `b1a23dfe8ba871c089c67e0203e527fce32854a9` | A3 interpretation and verification lineage |
| `c9fc068a7b3bc55073d4ba8fc6008b2984beba78` | A4a governance authorization |
| `4842354ef016fe1ce23208016f740dc22f6eb7ce` | A4a Fact-to-Need evaluation |
| `1f1e6ee5f49b803efa50682f81b5ac3ef13afb9a` | R1 governance authorization |
| `0bd62ee351b6a1ac0ca2f882ac338d790657f313` | R1 private Artifact ingestion |
| `1b766ea50c0467c706a3f2e778a7bf0cd40f96aa` | R2 governance authorization |
| `0e31ba490452b50e1cf618a23231d980d9ca4977` | R2 targeted interpretation boundary |
| `df7fcaad4ff962e7ffb22e5fe19e19824ca4c77e` | R3 governance authorization |
| `ec96fe358ef09bdec15dd14f23a7ade1b36aba06` | R3 multimodal interpretation and locators |
| `e1dec96dc3dc547d28af24735c37b1c7ea435c48` | R4 governance authorization |
| `450ae41e2871a5145667b8fec906a84d5b5bbc93` | R4 typed relational Facts |
| `96a0b05abe213f2ff83aaa9034438261cb088f9b` | A4b governance authorization |
| `c0cc91813e705741fc629497e997a38598163397` | R4 structured relational provider-output correction |
| `e0dd4d85be47cfb851d86f41778a9c3a20286b16` | A4b coverage and conflict assessment |
| `c54530931a8d8b2953d6f738adb09df406aec317` | A5a/A5b governance split |
| `851a029dff6a66e75c94f323007061c645cb7483` | A5a point-in-time reconstruction |
| `6111e50b1d42a292bd3eb9f8755995d7272b4856` | A5b governance authorization |
| `4602d763bd728f36b16de335cdd85cd6abced55d` | A5b immutable Evidence Packages |
| `9d8ba6fbd808b1306b628371867f3e68b43485ea` | V1 consumer-façade governance authorization |
| `c55354aeb334c7c99201ade7a5b3d96e030d3266` | Frozen V1 consumer façade implementation |

### Migration inventory

| Migration | Capability |
|---|---|
| 010 | A1 Evidence core tables and lineage |
| 011 | A2 collection-operation identity |
| 012 | A3 Facts, derivation, verification, and interpretation lineage |
| 013 | Fact-to-Artifact support |
| 014 | A4a Fact-to-Need evaluation |
| 015 | R2 targeted interpretation operations |
| 016 | R3 durable Fact locators |
| 017 | R4 typed relational Facts |
| 018 | A4b typed set assertions and coverage assessments |
| 019 | A5b immutable Packages and ordered membership |

Migrations 010–019 are additive and forward-only. Accepted migrations are immutable; future changes require a new sequential migration.

## Capability classification

| Capability | Classification | Current boundary |
|---|---|---|
| Public acquisition | Implemented and accepted | Generic Evidence records exist; Companies House is the accepted source-specific producer. The current A2 HTTP route is a Lab adapter, not a production-authenticated producer API. |
| Private Artifact ingestion | Production-capable service boundary | R1 accepts an already-authorized server-side upload, persists context-restricted Evidence, and reopens exact bytes. The browser/base64 route is Lab-only. |
| Storage and SHA-256 integrity | Implemented and accepted | Filesystem and private Vercel Blob adapters plus memory fixtures. SHA-256 protects Artifact bytes; it is neither Evidence identity nor authorization. |
| Authorization | Internal Evidence service | Tenant/context/subject and Asset-scope checks exist. Production caller authentication, actor proof, policy-to-scope mapping, and comprehensive audit logging are deferred. |
| Targeted interpretation | Production-capable service boundary | R2 is provider-neutral and idempotent. Its HTTP routes require a future trusted host authorization integration. |
| JSON/HTML interpretation | Implemented and accepted | A3/R2 provider adapter and deterministic fixtures. |
| PDF/image interpretation | Implemented and accepted | R3 bounded media validation and provider translation; interpretation support is independent of preservation support. |
| Locators | Implemented and accepted | Artifact, JSON/HTML, PDF-page, and truthful optional image-region support. Unreliable coordinate transforms are omitted. |
| Scalar, discovered, and derived Facts | Implemented and accepted | Immutable Facts with request/grounding/support and source/derivation lineage. |
| Relational Facts | Implemented and accepted | R4 typed extension; it does not determine UBO, canonical parties, or operative values. |
| Fact-to-Need evaluation | Internal Evidence service | A4a records relationship only; semantic evaluation remains explicit. Current HTTP surface is Lab-shaped. |
| Coverage/completeness/conflict assessment | Internal Evidence service | A4b produces provisional independent dimensions from explicitly supplied candidates/specification. Current HTTP surface is Lab-shaped. |
| Point-in-time reconstruction | Internal Evidence service | A5a read projection. Current HTTP routes explicitly reject production use. |
| Immutable Evidence Packages | Internal Evidence service | A5b canonical freeze/reopen/verify. Current HTTP routes explicitly reject production use; export is deferred. |
| V1 consumer façade | **FROZEN in-process contract** | `evidence/consumer/v1/index.js` is the only supported downstream import. Its DTOs are bounded and versioned at `c55354aeb334c7c99201ade7a5b3d96e030d3266`. No HTTP/authentication transport is implied. |
| Evidence Lab | Lab-only adapter | Product/Architecture Authority acceptance harness; never an authentication or production API boundary. |
| A1/A2/A3/A4a fixtures | Fixture/test-only | Deterministic characterization and demonstration; not production Evidence. |

## Accepted invariants and protecting coverage

| Accepted invariant | Protecting tests | Introduced | Coverage status |
|---|---|---|---|
| Requirement, Need, Acquisition, Asset, Artifact, run, and value are distinct linked records | A1 domain/persistence/platform tests; A1 DB smoke | A1 | Architecture/regression + deterministic fixtures + DB smoke |
| Public Evidence may remain reusable; private Evidence requires exact logical isolation and identical bytes grant no access | A1 domain; R1 service and DB smoke | A1/R1 | Architecture/regression + DB smoke + manual acceptance |
| Failed acquisition produces no successful Evidence Asset | A1 domain; A2 producer/persistence tests | A1/A2 | Architecture/regression + deterministic fixtures |
| Collection retry is idempotent, while deliberate recollection creates new immutable Evidence | A2 producer/history tests | A2 | Deterministic fixtures + manual live acceptance |
| Six Companies House acquisitions retain independent API/web provenance and partial failure | A2 producer/client/capture tests | A2 | Deterministic fixtures + real manual source acceptance |
| Exact Artifact bytes reopen with verified SHA-256 | A2/R1/A3 reader and persistence tests; R1/R3 DB smoke | A2/R1/R3 | Architecture/regression + DB smoke + manual acceptance |
| Requested/discovered and direct/derived Facts retain complete extraction and support lineage | A3 domain/extractor/live/persistence tests; A3 DB smoke | A3 | Deterministic provider fixtures + DB smoke + manual provider acceptance |
| Multiple coherent Artifacts may support one run only within one Evidence Asset | A3 multi-Artifact and R2 tests | A3/R2 | Architecture/regression + manual acceptance |
| Reinterpretation is append-only and history reopening causes no provider call | A3 history/live and R2 tests; R2 DB smoke | A3/R2 | Architecture/regression + DB smoke + manual acceptance |
| A4a evaluation never changes A3 support, Fact content, or KYC satisfaction | A4a tests; A4a DB smoke | A4a | Architecture/regression + deterministic fixtures + manual acceptance |
| Private ingestion preserves PDF/PNG/JPEG without interpreting them | R1 tests and DB smoke | R1 | Architecture/regression + byte fixtures + manual acceptance |
| Targeted interpretation validates authorization, operation keys, and explicit execution | R2 API/service tests and DB smoke | R2 | Architecture/regression + deterministic provider fixtures + manual acceptance |
| Multimodal inputs enforce media limits and persist only truthful locators | R3 tests and DB smoke | R3 | Architecture/regression + media fixtures + manual provider acceptance |
| Typed relationships require controlled grammar, valid values/temporal state, ordinary Fact, Artifact support, and locator | R4 tests and DB smoke | R4 | Architecture/regression + deterministic fixtures + real manual provider acceptance (6/6 candidates persisted) |
| A4b reports independent provisional dimensions and selects no winner | A4b tests and DB smoke | A4b | Architecture/regression + deterministic fixtures + manual acceptance |
| A5a excludes records not reconstructably available at the requested cutoff | A5a tests | A5a | Architecture/regression + manual acceptance |
| A5b freezes complete server-generated A5a membership, verifies canonical bytes/order, and rechecks member access | A5b tests and DB smoke | A5b | Architecture/regression + canonical golden cases + DB smoke + manual acceptance |
| The V1 façade separates trusted authorization from requests, preserves access denial, strips storage internals, reopens history read-only, and projects the complete deterministic six-relationship shape | `evidence/consumer/v1/__tests__/*.nodetest.js` | V1 closure | Deterministic contract fixtures + delegation/side-effect characterization |
| Existing KYC behavior remains isolated | Existing KYC Jest regression | All stages | 24 suites / 475 tests at A5b closure |

### Final characterization baseline

At A5b closure:

* complete Evidence Node test suite: **246/246 passed**;
* existing KYC regression: **24 suites / 475 tests passed**;
* disposable PostgreSQL: migrations **010–019** and A5b smoke passed;
* production build, Evidence Lab/server JavaScript parse, `git diff --check`, and secret scan passed; and
* final verification made no Companies House or paid provider request.

At the V1 consumer-façade closure candidate:

* focused V1 consumer-contract tests: **9/9 passed**;
* complete Evidence Node suite: **255/255 passed**;
* existing KYC regression: **24 suites / 475 tests passed**;
* production build and JavaScript parse checks passed; and
* verification made no Companies House call, paid provider call, or database migration.

The suite strongly protects architecture, persistence shape, failure semantics, and deterministic adapters. It is not a statistical measurement of semantic extraction quality.

## AI-quality gap

A versioned golden corpus is still required before semantic output is relied on at production quality. It should include representative JSON, HTML, PDF, and image Evidence with independently reviewed expected outputs and measure:

* extraction correctness and recall;
* false discoveries and unsupported interpretation;
* locator accuracy and support quality;
* typed-relationship validity and success rate;
* consistency across equivalent source representations; and
* model, instruction, schema, and provider regression.

Fixtures and successful manual examples prove the integration mechanics, not general accuracy. Define thresholds, review ownership, corpus privacy controls, regression gates, and approved model/instruction combinations before a paid-provider pilot is relied upon for material decisions.

## Pilot and production readiness matrix

| Readiness area | Classification | Required condition or rationale |
|---|---|---|
| Intentional public consumer façade | **COMPLETE — FROZEN IN-PROCESS** | `evidence/consumer/v1/index.js` is the only supported import and has protecting contract tests. Production activation still requires a trusted host and does not make Lab HTTP routes public. |
| Authentication | **V1 pilot blocker** | Integrate with a real host identity/session; never use Lab environment defaults as caller proof. |
| Authorization enforcement | **V1 pilot blocker** | Map authenticated caller/actor/purpose to trusted tenant, context, subject, and Asset scopes; add negative integration tests. Existing service checks remain the enforcement core. |
| API versioning | **Production blocker** | Publish versioned request/response/error envelopes and compatibility policy before multiple consumers depend on HTTP contracts. |
| Input and media validation | **Post-pilot enhancement** | Strong domain/media validation exists; add gateway/body limits, content-disposition hardening, and adversarial validation as contracts are exposed. |
| Background/durable jobs | **V1 pilot blocker** | Long source/browser/provider operations need durable state, cancellation/timeout behavior, and safe recovery for a non-supervised pilot. |
| Retries, timeouts, dead-letter handling | **Production blocker** | Idempotency and bounded provider failures exist, but there is no general durable retry/DLQ operating model. |
| Concurrency and rate limits | **Production blocker** | Add per-tenant/source/provider concurrency controls and abuse protection. Repository keys protect identity, not platform capacity. |
| Source/provider cost controls | **V1 pilot blocker** | Add per-tenant/model/source allowlists, quotas/budgets, and usage records. Lab buttons only make cost explicit; they do not govern spend. |
| Malware scanning | **V1 pilot blocker** | Scan/quarantine private customer uploads before making them available to consumers or interpreters. R1 validates format/integrity, not malware. |
| Storage monitoring | **Production blocker** | Monitor write/read failures, orphaned objects, capacity, latency, private Blob configuration, and integrity incidents. |
| Migration/release process | **Production blocker** | Establish deploy ordering, migration ownership, forward-only recovery, compatibility checks, and environment promotion evidence. |
| Access/audit logging | **V1 pilot blocker** | Record authenticated reads, ingests, interpretations, assessments, package operations, denials, and actor/purpose without leaking protected values. |
| Backup/recovery | **Production blocker** | Define and test PostgreSQL/object-store backup, restore, consistency reconciliation, RPO, and RTO. |
| Retention/deletion | **Production blocker** | Establish legal/product policy and coordinated logical/physical disposal. Limit any pilot to data covered by an explicit interim policy. |
| Secrets and rotation | **Production blocker** | Use managed secret storage, least privilege, rotation, revocation, and separate environment credentials. |
| Observability/alerting | **Production blocker** | Add correlation-aware metrics, structured errors, latency/failure dashboards, integrity/security alerts, and safe diagnostic references. |
| Load/performance | **Production blocker** | Establish workload limits and test database, Artifact, browser, provider, reconstruction, and Package behavior at expected scale. |
| Runbooks | **V1 pilot blocker** | Provide minimum operator procedures for failed/partial collection, provider outage, stuck work, storage failure, integrity failure, access incident, and rollback/escalation. |
| Provider/model/prompt governance | **V1 pilot blocker** | Approve models/instructions, version changes, data-processing terms, quality gates, fallback rules, and rollback. Raw provider exchange retention remains a separate decision. |

## Deferred register

### Production blockers or policy gates

* trusted host authentication/authorization and access/audit integration;
* versioned production API envelopes and consumer compatibility policy;
* durable execution, cost/rate control, operational monitoring, runbooks, and release processes;
* malware scanning and safe upload quarantine;
* backup/recovery, secrets rotation, and retention/disposal policy;
* golden-corpus quality thresholds for any semantic workflow used in the pilot; and
* coordinated policy for protected/private data and external provider processing.

### Post-pilot product enhancements

* authorized Evidence viewer/export and Package PDF/ZIP exports;
* known-domain company-website producer and additional registries;
* source-specific capture optimizations;
* configurable freshness/staleness and source-suitability policy;
* scheduled recollection and change detection;
* automatic source selection/fallback;
* adverse-media/open-web research;
* richer provider fallback and model portfolio; and
* downstream decision provenance and Case Explanation.

### Separate future architecture

* external-custody IDV Evidence identity;
* Vault-backed protected-value references;
* Verification Observation and Provider Assertion primitives;
* IDV-to-Evidence integration envelope;
* reconstruction/Package semantics for Vault and external-custody members;
* coordinated retention/access for external-custody evidence; and
* any retention of raw provider requests/responses.

Didit-held passport, selfie, or biometric content is not locally preserved Evidence under V1.

## V1 completion and Control Room closure

Architecture Authority has closed Evidence Core V1 into maintenance after it:

1. accepted the Core V1 baseline through `4602d763bd728f36b16de335cdd85cd6abced55d`, governance commit `9d8ba6fbd808b1306b628371867f3e68b43485ea`, and façade implementation `c55354aeb334c7c99201ade7a5b3d96e030d3266`;
2. approved this inventory, contract document, and the three readiness verdicts;
3. froze migrations 010–019 and the accepted ADRs as immutable history;
4. confirmed no further generic Evidence domain feature is required before producer/consumer integration;
5. assigned the blockers above to the appropriate platform, security, operations, producer, and consumer control rooms; and
6. required every future Evidence change to enter through a versioned contract, new ADR where material, additive migration, characterization coverage, and KYC regression gate.

Maintenance means fixing defects and governing compatible contract evolution. It does not authorize production exposure or imply that pilot blockers are complete.

## Recommended next tracks

1. **Evidence Producers Control Room:** formalize the generic producer contract, then implement a known-domain company-website producer without changing Evidence identity.
2. **Trusted host/platform integration:** authentication, authorization mapping, versioned HTTP boundary, audit, durable operations, and cost controls.
3. **KYC controlled vertical:** one bounded company-identity/address Need flow through Evidence and back to KYC-owned operative/customer workflow.
4. **UBO adapter:** place Evidence R2 behind UBO-owned extraction/discovery interfaces; retain UBO determination outside Evidence.
5. **IDV architecture:** design external-custody/Vault references before integrating Didit or any protected identity content.
6. **Quality and operations:** golden corpus, security gates, storage/recovery, observability, and runbooks.
