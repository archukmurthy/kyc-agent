# Evidence Platform — Current Build Brief

# Evidence Consumer Readiness R4 — Typed Relational Facts

## Governance Status

R3 PDF/Image Interpretation + Durable Evidence Locators was accepted and implemented at `ec96fe358ef09bdec15dd14f23a7ade1b36aba06`.

ADR-017 and this R4 brief were approved by Architecture Authority on 2026-09-01. The bounded R4 implementation is authorized. A4b, UBO integration, downstream KYC decisions, and changes to existing KYC behavior remain deferred.

---

## 1. Objective

Define the smallest provider-neutral Evidence model through which an individual source-supported relationship can become machine-readable without becoming a downstream compliance conclusion.

```text
source Artifact
        ↓
R3 interpretation
        ↓
ordinary immutable Evidence Fact
        ↓
validated typed relationship semantics
        ↓
downstream candidate
```

Evidence stops at the relationship asserted by the source. R4 does not determine UBO/controller status, calculate effective or indirect ownership, apply thresholds, choose an operative claim, assess requirement coverage, decide KYC satisfaction, or perform A4b aggregation.

---

## 2. Observed existing capability and limitation

The accepted A3/R3 platform already provides:

* immutable `evidence_facts` linked to one Extraction Run and a primary Artifact;
* requested or discovered status without fabricated schema linkage;
* direct or derived grounding;
* JSONB `fact_value`, which safely persists strings, numbers, booleans, arrays, and objects;
* source wording in `raw_representation`;
* explainable A3 support state and support signals;
* explicit derivation input/transformation/version/time lineage;
* precise Fact-to-Artifact support pairs;
* one or more durable R3 locators beneath each support pair;
* capture, extraction, provider, model, instruction, and verification history; and
* append-only reinterpretation.

Persisted Lab Facts already contain object and array values for officers, PSCs, ownership structures, registered addresses, and other concepts. Those values are preserved correctly as JSONB.

The limitation is that arbitrary JSONB is not typed relational semantics. Neither migration 012 nor the A3 domain validator establishes:

* which party is subject and which is object;
* a versioned relationship vocabulary;
* grammatical direction;
* exact versus range versus unknown quantity;
* numeric units or count-of-total meaning;
* relationship-specific temporal state; or
* deterministic party and value validation.

An opaque object can be reconstructed as provider output, but a downstream consumer must still guess what it means. That is insufficient for stable typed relationships.

---

## 3. Recommended Evidence-native model

Retain one ordinary Evidence Fact identity and add a typed one-to-zero/one relationship extension:

```text
evidence_facts
      1
      ↓ 0..1
typed relationship extension
```

The Fact remains authoritative for:

* immutable identity;
* Extraction Run and provider/model/instruction lineage;
* requested/discovered state;
* direct/derived grounding;
* raw source wording;
* support state;
* Fact-to-Artifact support;
* R3 locators; and
* historical interpretation.

The extension supplies only validated relationship semantics. It is not a parallel Fact, graph truth, canonical entity record, or downstream claim.

One typed relational Fact represents exactly one directed source assertion. A document containing multiple independent relationships normally creates one ordinary Fact and extension per relationship. It must not hide those assertions in one opaque typed relationship array. Existing historical array/object Facts remain valid; an explicit later mapping creates separate derived Facts with transformation lineage.

For an explicit source statement, one direct Fact may carry the raw wording and typed extension. When an already-persisted untyped Fact or source-specific code is mapped later, append a new derived Fact with `evidence_fact_derivations` lineage and attach the extension to the new Fact. Never rewrite the input Fact.

---

## 4. Source-party snapshots

Both subject and object use bounded source-party snapshots. At minimum they can represent:

* `natural_person`;
* `legal_entity`;
* `trust_or_legal_arrangement`; and
* `unknown_or_other` when the source is unclear.

A party snapshot preserves only source-supported attributes:

* source-recorded name or description;
* explicitly stated jurisdiction;
* explicitly stated registry identifiers with scheme/value/jurisdiction; and
* bounded source-specific party metadata needed for reconstruction.

These snapshots are not canonical people, companies, UBOs, or Evidence subjects. Equal names or identifiers do not merge them. Global identity resolution remains downstream and separately governed.

---

## 5. Direction and relationship vocabulary

R4 uses one versioned grammar:

```text
subject relationship object
```

The subject holds, exercises, performs, or is assigned the relationship toward the object.

```text
Alice ECONOMIC_OWNERSHIP HoldCo Ltd
```

means Alice owns HoldCo Ltd. Passive wording such as `HoldCo is 70% owned by Alice` must normalize to the same direction. Provider-native field order or diagram-arrow orientation must never define stored direction. Ambiguous direction produces no typed relationship.

The initial versioned neutral vocabulary should cover:

* economic/share ownership;
* voting rights;
* appointment rights;
* removal rights;
* formal decision/control rights;
* significant influence or control;
* director and officer relationships;
* authorized signatory relationships;
* settlor, trustee, protector, and beneficiary roles;
* control over an intermediary or trust;
* nominee/on-behalf-of relationships; and
* `OTHER` only for an understood source relationship outside the initial vocabulary, retaining its source label and meaning.

The persisted codes and grammar are versioned. Provider labels and UK PSC condition codes remain source-specific metadata. Mapping to a neutral code occurs only through an explicit deterministic, versioned mapping. There is no generic unknown relationship code: ambiguous meaning or direction remains an ordinary Fact with a typed-mapping limitation.

---

## 6. Value model

Relationship value must distinguish at least:

```text
EXACT
RANGE
QUALITATIVE
UNKNOWN
```

It must also identify the measure shape, such as:

* percentage;
* count-of-total;
* absolute numeric amount;
* qualitative classification; or
* no stated quantity.

Examples:

```text
exactly 70%
  kind: EXACT
  measure: PERCENTAGE
  value: 70

more than 25% but not more than 50%
  kind: RANGE
  measure: PERCENTAGE
  lower: 25
  lowerInclusive: false
  upper: 50
  upperInclusive: true

may appoint 3 of 5 directors
  kind: EXACT
  measure: COUNT_OF_TOTAL
  numerator: 3
  denominator: 5

majority voting rights
  kind: QUALITATIVE
  source value: majority

percentage not stated
  kind: UNKNOWN
```

R4 never converts a range to a midpoint, a qualitative statement to a number, or unknown to zero. Deterministic validation rejects malformed bounds, invalid inclusivity, lower greater than upper, invalid percentages, and invalid count denominators.

---

## 7. Temporal relationship assertions

R4 may preserve explicitly source-supported:

* `current`;
* `ceased`;
* `historical`;
* `unknown_currentness`;
* effective-from;
* effective-to; and
* source-effective date with source precision.

Capture time, Extraction Run time, filing/notification time, and relationship-effective time remain distinct. No current state is inferred solely from the absence of a cease date. Historical and contradictory relationship Facts coexist. R4 does not implement latest-wins or temporal applicability policy.

---

## 8. Raw Fact, typed form, and lineage

The source wording remains reconstructable. A relationship card must be able to show both:

```text
source wording:
  ownership of shares — more than 25% but not more than 50%

typed form:
  ECONOMIC_OWNERSHIP
  RANGE (>25, <=50)
```

Every typed relationship reconstructs through:

```text
typed extension
    ↓
Fact
    ↓
Extraction Run / mapper / model / instruction / version
    ↓
supporting Artifact(s)
    ↓
R3 locator(s)
```

For deterministic mapping of a source-specific Fact, the derived Fact additionally reconstructs through `evidence_fact_derivations` to its input Fact and versioned transformation.

---

## 9. Deterministic structured-output validation

Provider/model-produced typed output must pass a versioned Evidence-owned schema validator before persistence. Validate at minimum:

* allowed party types and required bounded party structure;
* supported relationship code or qualified other/unknown handling;
* subject–relationship–object direction;
* exact/range/qualitative/unknown value shape;
* numeric bounds, inclusivity, unit, and count-of-total consistency;
* temporal fields and source precision;
* selected input Artifact and Fact support linkage; and
* mapper/extractor/schema version lineage.

Malformed output does not silently become a typed relationship. A safe underlying untyped Fact may remain with its source wording and support. Typed mapping failure remains visible through immutable Extraction Run failure/completeness/limitation metadata. A post-hoc mapping failure leaves its input Fact unchanged.

Provider confidence is extraction metadata only. It is not evidence strength, UBO confidence, KYC confidence, source trust, or a selection threshold.

---

## 10. Companies House PSC compatibility

Existing Companies House PSC API evidence preserves names, PSC kinds, nature-of-control codes, notification dates, cease dates, statements, exemptions, and raw pagination. The current A2 deterministic extractor also emits schema-specific PSC objects and bounded ownership/voting bands. Those are not yet provider-neutral relational Facts, and R4 does not modify A2.

A future R4 mapping can, where deterministic:

* map explicit PSC person/entity kind to a source-party type;
* map ownership-of-shares codes to economic-ownership ranges;
* map voting-rights codes to voting-rights ranges;
* map explicit appointment/removal codes to neutral rights; and
* map significant-influence/control codes to a qualified neutral relationship.

The original Companies House code remains source-specific metadata. A mapping from code to neutral relationship retains mapper/version lineage and, where it transforms an input Fact, explicit derivation lineage.

PSC statements, exemptions, unavailable information, and no-registrable-PSC states are valid source evidence but are not party-to-party relationships. They must not be converted into fake zero ownership or an empty relationship edge.

---

## 11. A4a and A4b boundary

A typed relational Fact remains an immutable Fact that A4a may evaluate against an explicitly supplied Information Need. R4 does not change A4a architecture and does not run A4a automatically.

No A4a migration is required for R4. Existing semantic A4a evaluation can receive a structured Fact. A future deterministic relational comparator may consume the typed extension under A4a's existing structured/component-comparison authority, but that implementation requires separate scope.

A4b remains responsible for later reasoning across candidate Facts, including completeness, cardinality, conflicts, legitimate empty sets, temporal applicability, and provisional requirement coverage. R4 does none of that work.

---

## 12. Persistence recommendation

Opaque `evidence_facts.fact_value` JSONB alone is not sufficient typed integrity. A standalone relationship model disconnected from Facts would duplicate identity and provenance.

The authorized minimum is one forward-only additive relationship extension after migration 016, keyed one-to-one by `fact_id`. Critical relationship, direction, value-kind, measure, and temporal invariants use typed columns and database checks where practical. Bounded party snapshots, source-specific metadata, qualifiers, and source precision may use deterministically validated JSONB.

Migration 017 is authorized as the next migration. Do not modify migrations 010–016. Exact table/property names and the final typed-column/validated-JSON split remain reversible implementation details within the approved architecture.

---

## 13. Required future characterization

R4 implementation must characterize at minimum:

1. natural person → legal entity exact 70% ownership;
2. legal entity → legal entity ownership;
3. percentage range with correct inclusivity;
4. unknown percentage that is not zero;
5. voting rights distinct from economic ownership;
6. appointment right expressed as 3 of 5 directors;
7. removal right;
8. significant influence/control assertion;
9. nominee/on-behalf-of relationship;
10. trust → company ownership;
11. settlor, trustee, protector, and beneficiary roles;
12. explicit current relationship;
13. ceased relationship;
14. unknown currentness;
15. one Artifact producing several relationship Facts;
16. contradictory relationship Facts coexisting without a winner;
17. malformed provider output preserving no fabricated typed relationship;
18. deterministic PSC range mapping with the original code preserved;
19. PSC statement/no-registrable-PSC state remaining non-relational;
20. complete Fact → support pair → R3 locator reconstruction; and
21. append-only reinterpretation preserving prior typed history.

Product presentation should separate source assertion from downstream conclusion and show internal IDs only as secondary technical detail.

---

## 14. Explicit exclusions and stop conditions

R4 does not authorize:

* canonical person/company/trust identity or entity resolution;
* UBO/controller IDs, qualification, thresholds, or conclusions;
* ownership-chain traversal or percentage multiplication;
* source winner, operative value, or latest-wins selection;
* KYC satisfaction, customer action, analyst decision, or onboarding progression;
* A4b coverage, set/cardinality, conflict, or requirement assessment;
* new Information Needs or schema mutation;
* A2 Companies House producer changes;
* automatic A4a evaluation;
* raw provider exchange persistence;
* changes to migrations 010–016; or
* changes to existing KYC, Pre-boarding, or UBO behavior.

Stop for Architecture Authority before implementation if R4 requires a parallel Fact identity, ambiguous provider-directed edges, implicit entity merging, uncertain source-code mapping, inferred currentness, numeric invention, weakening Fact support/locator lineage, A4a/A4b redesign, or downstream policy conclusions.

Architecture Authority approved ADR-017, the one-to-one extension model, the initial versioned vocabulary, party/value/temporal grammar, direct-versus-derived mapping rule, and migration 017 direction on 2026-09-01.

---

# Prior Accepted Build Brief — R3 PDF/Image Interpretation + Durable Evidence Locators

## Governance Status

R3 was accepted and implemented at `ec96fe358ef09bdec15dd14f23a7ade1b36aba06` under approved ADR-016.

The remainder of this file preserves the accepted R3 brief for governance history. R4 does not reopen or alter R3 behavior.

---

## 1. Objective

Extend the existing A3 interpretation engine and stable R2 consumer boundary so that an authorized consumer can explicitly interpret an already-preserved PDF, PNG, or JPEG and receive immutable source-supported Facts with useful durable locations inside the supporting Artifact.

```text
preserved R1 PDF / PNG / JPEG
        ↓
R2 operation + trusted tenant/context
        ↓
server-side resolve and authorize
        ↓
read exact bytes + verify persisted SHA-256
        ↓
provider-neutral multimodal input
        ↓
configured multimodal provider adapter
        ↓
immutable A3 Extraction Run + Facts
        ↓
Fact-to-Artifact support + durable locator
```

R3 must not create a second extraction engine. It adds interpretation media and locator lineage to the existing A3/R2 path.

---

## 2. Existing capability to reuse unchanged

The current platform already provides:

1. R1 preservation and authorized reopen of exact PDF, PNG, and JPEG bytes;
2. production Vercel Blob and local Evidence-only filesystem storage adapters;
3. server-side Artifact resolution without browser storage references;
4. exact public or private tenant/context authorization;
5. SHA-256 verification before semantic provider execution;
6. R2 operation-key idempotency and explicit fresh execution;
7. neutral requested concepts plus A3 open discovery;
8. explicit same-Evidence-Asset multi-Artifact selection and ordering;
9. append-only Extraction Run and Fact persistence;
10. explicit Extraction Run input Artifacts;
11. immutable Fact-to-Artifact support pairs;
12. provider/model/instruction and extraction timestamps;
13. requested/discovered and support/completeness states; and
14. historical reopening without storage/source/provider calls.

R3 must reuse these boundaries. It must not create parallel Artifact retrieval, authorization, fingerprint, operation, Fact, support, or history concepts.

---

## 3. Current blocking enforcement and adapter gap

The current JSON/HTML-only restriction exists in two layers:

* `evidence/a3/liveService.js` defines only `application/json`, compatible `+json`, and `text/html` as live-supported media. It rejects another MIME before reading bytes or invoking the provider.
* `evidence/r2/service.js` performs the same capability check before delegating to A3 and persists an `unsupported_media_type` R2 operation outcome.

For accepted text media, A3:

1. reads bytes with `EvidenceArtifactReader`;
2. recalculates SHA-256;
3. converts the bytes with UTF-8 decoding; and
4. supplies `decodedText` and Artifact metadata to `SemanticExtractionProvider.extract`.

The current Anthropic adapter then concatenates all decoded Artifact text and instructions into one string `messages[0].content`. It does not construct Anthropic `image` or `document` content blocks and cannot safely interpret binary bytes by removing only the media allowlist.

R3 therefore needs bounded media routing and a multimodal adapter, not a storage redesign.

---

## 4. Provider-neutral multimodal content boundary

The Evidence provider interface should receive an ordered list of verified content items conceptually equivalent to:

```text
{
  artifactId,
  order,
  mediaType,
  representationType,
  kind: text | image | document,
  text? | verifiedBytes?,
  safeSourceMetadata
}
```

Exact property names are implementation details. The invariants are:

* every item maps to one already-authorized persisted Artifact;
* text is decoded only for text media;
* image/PDF bytes remain bytes until the provider adapter encodes them;
* Artifact boundaries and authoritative ordering remain explicit;
* SHA-256 is verified before an item reaches the provider;
* storage keys, Blob URLs, filesystem paths, and credentials are absent;
* one provider call may contain several coherent items from the same Asset; and
* provider-specific block types do not enter Evidence domain models.

The Anthropic adapter may translate these items into text, base64 `image`, and base64 `document` blocks. It must select only a configured model known to support all requested media. Model/media capability rejection is distinct from a source fact being absent.

R3 does not authorize provider Files API retention. If later adopted for payload/latency reasons, provider-file lifecycle, privacy, retry, and deletion semantics require separate operational approval.

---

## 5. Bounded media support and validation

R3 interpretation support is limited to:

| Media | R3 route |
|---|---|
| `application/json`, compatible `+json` | verified text |
| `text/html` | verified text |
| `application/pdf` | verified PDF/document bytes |
| `image/png` | verified image bytes |
| `image/jpeg` | verified image bytes |

No other R1 or provider media capability is implied.

### PDF limits

The first R3 implementation must enforce:

* valid standard PDF signature and structural readability;
* no password protection or encryption;
* maximum 10 MiB original bytes, consistent with R1's preservation ceiling;
* maximum 100 pages per request; and
* combined provider request/context limits after all selected Artifacts and instructions are included.

### Image limits

The first R3 implementation must enforce:

* canonical PNG/JPEG signature and parseable dimensions;
* maximum 8,000 pixels on either dimension;
* maximum encoded provider image block of 10 MB for direct Anthropic API use;
* therefore approximately 7.5 MB maximum raw bytes for a directly base64-embedded image unless a separately approved transport avoids that overhead; and
* maximum 20 explicitly selected Artifact blocks in one R2 request.

Independently of the Artifact-count limit, aggregate original binary content passed through one direct-base64 interpretation request must not exceed 20 MiB. Preflight must also enforce any stricter active provider/model request limit before a paid call.

Configured limits may be lower. An R1 Artifact larger than an R3 interpretation limit remains valid preserved Evidence and receives `media_too_large`; it is not lost or malformed.

Validation uses authoritative preserved bytes and canonical persisted MIME. Filename extension is never sufficient. Checks that can be made deterministically must occur before a paid provider call.

Evidence Platform must not rasterize, resize, crop, transcode, recompress, rewrite, replace, or discard the preserved canonical Artifact merely to perform interpretation. Its SHA-256 remains tied to the original bytes. Provider-side PDF page rendering or image downscaling is execution behavior, not a new Evidence Artifact, and must be reflected as a limitation/context where material. It must never be presented as original-source geometry or used to silently manufacture coordinate transforms. A future Evidence-generated rendition requires its own Artifact and transformation provenance.

---

## 6. Durable Evidence locator model

A locator is immutable support lineage beneath an existing Fact-to-Artifact support pair.

```text
Fact
  ↓
Fact-to-Artifact support
  ↓
one or more durable locations inside that Artifact
```

It answers where the support appears; it does not decide whether the Fact satisfies a Need, is operative, is trustworthy, or proves UBO status.

### JSON

Prefer:

* JSON Pointer or an equivalently deterministic path/key; and
* a bounded raw support excerpt/value.

### HTML

Prefer:

* a stable section/DOM-style locator when reliably available; and
* a bounded supporting excerpt.

If no stable DOM path can be derived without fabricating stability, preserve the excerpt and explicitly qualify the locator.

### PDF

Require at minimum:

* one-indexed page or page range within the verified document page count; and
* bounded cited/supporting text or a truthful visual support description.

Anthropic structured PDF citations may be normalized into this model. A citation's provider document index must map back to the corresponding selected Artifact. Text citations do not cover an image-only PDF region; a visually extracted Fact must retain an explicit page/support description and qualification instead of pretending it has a textual citation.

### PNG/JPEG

Require at minimum:

* the supporting Artifact; and
* a bounded support description/excerpt identifying what in the image supports the Fact.

Bounding boxes/regions are optional. No box may be fabricated. A box is persistable only when its coordinate system, source dimensions, provider-visible dimensions/transformation, and mapping/qualification are recorded. Provider coordinates that refer only to an automatically resized image are not silently treated as original-Artifact pixels.

---

## 7. Additive locator persistence

Migration 013 represents only:

```text
(fact_id, artifact_id, created_at)
```

It cannot represent multiple locations, page ranges, paths, excerpts, descriptions, or coordinate spaces. Fact `support_signals`, `source_policy_context`, Artifact metadata, and Extraction Run metadata are not clean identities for a per-Fact/per-Artifact locator.

R3 therefore proposes one new additive, forward-only migration after 015 for an immutable child relation such as `evidence_fact_artifact_locators`.

Each row should contain only the applicable bounded fields from:

* locator ID and ordinal;
* Fact ID and supporting Artifact ID;
* locator kind/media;
* JSON path;
* HTML section/DOM reference;
* PDF page start/end;
* bounded support excerpt or description;
* optional bounded region metadata and coordinate space;
* locator method/qualification metadata; and
* created time.

The row must reference an existing Fact-to-Artifact support pair. Several locators may support the same Fact from the same Artifact. Existing migrations 010–015 must not be modified.

---

## 8. Mixed coherent Artifact sets

R3 may interpret one Artifact or an explicit coherent ordered set belonging to one Evidence Asset.

Allowed examples include:

```text
rendered HTML + screenshot image
```

and, when both representations already exist with transformation provenance:

```text
PDF + rendered page images
```

Every selected Artifact is independently resolved, authorized, read, fingerprint-verified, and recorded as a run input. Each Fact identifies only the Artifact(s) that actually support it, and locators attach separately beneath those support pairs.

Cross-Asset, cross-acquisition, cross-recollection, cross-context, or arbitrary media bundles remain prohibited. R3 does not create a new combined Evidence Asset merely for interpretation.

---

## 9. Provider result and locator normalization

The provider response must continue to report:

* Facts and requested/discovered relation;
* supporting Artifact IDs;
* requested-concept outcomes;
* extraction completeness and limitations; and
* support/ambiguity signals.

R3 adds bounded provider-neutral locator output for every persisted Fact/support pair. The adapter validates:

* referenced Artifact IDs are selected run inputs;
* page numbers are within the verified PDF page count;
* JSON/HTML locators have bounded valid forms;
* excerpts/descriptions are bounded and safe for PostgreSQL;
* regions have a declared coordinate space/dimensions; and
* unsupported precision is discarded and recorded as a limitation rather than repaired by invention.

A valid source-derived Fact lacking the minimum locator required for its media must not be discarded or presented as fully located. Preserve it with `needs_verification`, record an explicit locator limitation, and mark the relevant interpretation/completeness result partial. Do not persist an invalid locator. A weaker but truthful locator is retained and qualified; stronger precision is never fabricated.

Raw Anthropic requests/responses remain unpersisted.

---

## 10. Temporal and currentness semantics

R3 may preserve explicit source statements such as:

* current;
* ceased;
* historical;
* effective from;
* effective to;
* source effective date; and
* unknown or ambiguous currentness.

Such statements remain ordinary requested/discovered A3 Facts with raw representation, support state, and locator. The R1 `artifact_metadata.sourceEffectiveDate` remains host-supplied Artifact provenance and is not automatically converted into a source Fact.

Do not infer `current` merely because a cease date is absent unless the authoritative source contract explicitly establishes that rule. Do not solve temporal applicability, ownership-at-time, or effective indirect ownership. Typed relational/temporal semantics remain R4 or later policy work.

---

## 11. Failure model

R3 must keep these outcomes distinct:

| Outcome | Meaning |
|---|---|
| `unsupported_media_type` | media is outside governed R3 interpretation types |
| `unsupported_model_media` | configured provider/model cannot accept the selected item set |
| `invalid_media` | bytes fail signature/structural/dimension parsing |
| `encrypted_media` | PDF is protected and cannot be interpreted |
| `media_too_large` | byte/page/pixel/count/request limit is exceeded |
| `artifact_storage_unavailable` | authorized persisted bytes cannot be reopened |
| `artifact_integrity_mismatch` | reopened bytes do not match persisted SHA-256 |
| `provider_unavailable` / provider failure | provider could not perform interpretation |
| `provider_media_rejected` | provider rejected an otherwise governed media request |
| `provider_malformed_output` | normalized Facts/locators cannot be parsed safely |
| `provider_output_truncated` | result is incomplete because output was cut off |
| `locator_invalid_or_missing` | a persisted Fact cannot be truthfully located to the governed minimum |
| `not_found` | interpretable, complete input legitimately lacks a requested fact |
| `not_evaluated` / incomplete | limitations prevented a complete answer |
| `database_persistence_failed` | append-only run/fact/support/locator transaction failed |

Failures do not mean `no facts`. No provider failure, invalid locator, unavailable bytes, corrupt media, or oversized input may fabricate a Fact. Failed R2 operations and A3 runs remain immutable where safely persisted.

---

## 12. Append-only history and deliberate reinterpretation

R3 retains the R2 distinction:

```text
select/open existing Artifact and history
  external source call: NO
  provider call: NO
  new run: NO

run fresh multimodal interpretation
  external source call: NO
  provider call: YES/MAYBE
  new immutable R2 operation and A3 run: YES
```

Historical reopening returns the persisted Extraction Run, ordered input Artifacts, Facts, support pairs, locators, provider/model/instruction lineage, timestamps, requested-concept outcomes, completeness, limitations, and failure state without another provider call.

A deliberate reinterpretation uses a new R2 operation key and appends new operation/run/fact/support/locator history. It never changes the preserved Artifact or prior interpretation.

---

## 13. Lab acceptance

The Evidence Lab should eventually allow the reviewer to:

1. choose the previously preserved Tesco annual-report PDF or ownership-chart PNG;
2. select the authorized context and human-readable Evidence Asset/Artifacts;
3. enter neutral requested concepts;
4. see media/model readiness and bounded-limit validation;
5. see that a fresh run may make a paid provider call;
6. explicitly run one fresh interpretation;
7. inspect requested and discovered Facts;
8. inspect precise Fact-to-Artifact support;
9. inspect PDF page/excerpt or image support description/region where reliable;
10. reopen prior R3 history without a provider call; and
11. deliberately reinterpret using a new operation key.

Selection must not make an AI call. No Companies House recollection is needed. Internal UUIDs remain secondary technical metadata.

---

## 14. Required future characterization

When separately authorized, implementation must prove at minimum:

1. persisted PDF interpretation;
2. persisted PNG interpretation;
3. persisted JPEG interpretation;
4. SHA-256 verification before provider invocation;
5. one PDF producing several Facts;
6. one image producing several Facts;
7. PDF page/page-range locator plus supporting excerpt/description;
8. image Artifact locator plus support description;
9. no fabricated bounding box;
10. coherent HTML plus screenshot interpretation;
11. authoritative same-Asset ordering;
12. precise Fact-to-Artifact support and locator separation;
13. corrupt, encrypted, and oversized PDF handling;
14. corrupt and oversized image handling;
15. provider/model media rejection without a Fact;
16. provider failure and malformed/truncated result;
17. explicit current, ceased, and unknown-currentness handling;
18. append-only reinterpretation;
19. historical reopening without provider execution;
20. no storage reference/credential exposure;
21. no raw provider exchange persistence; and
22. no R4/UBO/A4b conclusion.

All automated tests use fixture providers and disposable infrastructure. No paid provider or external evidence-source request is required.

---

## 15. Explicit exclusions and stop conditions

R3 does not authorize:

* a second extraction engine;
* new Evidence, Artifact, subject, access, or operation identity;
* browser-supplied storage locations or bytes as authority;
* provider Files API lifecycle/retention;
* raw provider request/response persistence;
* silent rasterization, conversion, resizing, or derived Artifacts;
* cross-Evidence-Asset interpretation;
* fabricated page/path/region precision;
* graph edges or typed relational Facts;
* ownership/control calculations;
* PSC/UBO/controller classification or thresholds;
* `isUbo`, `qualifies`, or effective indirect ownership;
* A4a auto-execution, A4b, satisfaction, winner, or operative-value selection;
* KYC/Onboarding/UBO contract changes; or
* changes to migrations 010–015.

Stop for Architecture Authority if implementation requires weakening access isolation, bypassing SHA verification, sending storage references to a provider, creating cross-Asset bundles, silently transforming preserved media, inventing locators, persisting raw provider exchanges, or solving R4 to represent a result.

---

## 16. Future completion criteria

R3 is complete only after separate implementation authorization and proof of:

```text
authorized preserved PDF/image
        ↓
validated and bounded media
        ↓
SHA-256 verified bytes
        ↓
provider-neutral multimodal interpretation
        ↓
immutable A3 Facts
        ↓
precise supporting Artifact(s)
        ↓
durable strongest-non-fabricated locator(s)
        ↓
historical no-provider reopening
        ↓
R4/A4b/downstream decision: NOT PERFORMED
```

---

# Prior Accepted Build Brief — R2 Targeted Interpretation Boundary

## Governance Status

This is the approved R2 implementation brief after completed R1 at commit `0bd62ee351b6a1ac0ca2f882ac338d790657f313`.

Architecture Authority has approved ADR-015, resolved fresh-execution idempotency, and authorized only the bounded R2 implementation described here.

R3, R4, A4b, UBO integration, and existing KYC behavior remain deferred and outside this build.

---

## 1. Objective

Define the smallest stable, provider-neutral Evidence boundary through which an already-authorized consumer may request targeted interpretation of already-preserved Evidence Artifacts.

```text
authorized consumer
      ↓
persisted Artifact IDs
+ neutral requested concepts
+ bounded extraction context
+ opaque correlation
      ↓
Evidence resolve → authorize → read → verify SHA-256
      ↓
existing A3 interpretation machinery
      ↓
immutable Extraction Run + reusable Facts + lineage
```

R2 wraps and hardens A3 for downstream integration. It does not create a second interpretation engine.

---

## 2. Existing A3 capability to reuse

`LiveArtifactInterpretationService.interpret` already accepts internally:

```text
artifactId or artifactIds[]
tenantId
contextId?
requestedConcepts[]?
extractionContext?
```

It already:

1. resolves each persisted Artifact through the repository;
2. authorizes public or exact private tenant/context access;
3. rejects cross-Evidence-Asset input sets;
4. orders persisted multi-page Artifacts and assesses input completeness;
5. rejects unsupported media before provider execution;
6. reads bytes from authoritative server-side storage;
7. verifies persisted SHA-256 for every Artifact;
8. sends several requested concepts in one provider request;
9. accepts several provider Facts in one run;
10. distinguishes requested and discovered Facts;
11. preserves explicit Fact-to-Artifact support;
12. records provider, model, instruction, extraction context, timestamps, and support;
13. appends immutable Extraction Run history; and
14. reopens history separately without a provider call.

The minimum R2 implementation should delegate to these capabilities rather than duplicate them.

---

## 3. Current integration gaps

The current `/api/evidence/a3-interpret` and `/api/evidence/a3-history` handlers are Lab/internal adapters, not stable production consumer contracts.

They currently:

* resolve tenant from server environment but do not propagate an authorized `contextId`;
* therefore cannot use the corrected exact-context path for private R1 Artifacts;
* ignore caller `requestedConcepts` and `extractionContext` even though the internal service supports them;
* default missing values to standalone Evidence Lab concepts/context;
* have no opaque correlation envelope;
* return a large Lab-shaped object containing internal structures;
* do not validate concept count, description size, context shape, or Artifact-set bounds;
* do not expose a distinct unsupported-concept state; and
* have no operation-level idempotency contract for a lost-response retry.

R2 must add a new stable adapter. It must not silently redefine the existing Lab endpoints as production contracts.

---

## 4. Proposed R2 request boundary

Conceptually:

```text
interpretArtifacts({
  artifactIds: [...],
  requestedConcepts: [
    { concept, description? }
  ],
  extractionContext: {
    jurisdiction?,
    language?,
    schemaReference?,
    schemaVersionReference?,
    purpose?,
    otherApprovedNeutralConstraints?
  },
  correlation: {
    requestId?,
    externalReferences?: [{ system, type, id }]
  }
})
```

Exact API/service names and bounded size/count limits remain implementation details.

Trusted host state supplies authorized tenant, Evidence context, actor, and authorization. The request payload is not proof of authority.

Consumers supply persisted Artifact IDs only. They do not supply authoritative bytes, fingerprints, media/source metadata, Blob URLs, filesystem paths, storage keys, or credentials.

---

## 5. Neutral requested concepts

R2 supports one or several neutral Evidence semantic concepts in one interpretation operation. Examples include:

* economic ownership relationship;
* voting rights;
* appointment or removal rights;
* registered entity identifiers;
* former legal names; and
* registered address.

The request must not instruct Evidence to determine UBO/controller status, calculate policy ownership thresholds, satisfy a KYC requirement, select a winner, or make an operative business decision.

Consumer-domain Information Need IDs, policy IDs, UBO IDs, or similar references belong only in opaque correlation. They do not become Evidence Information Needs, schema fields, foreign keys, or provider instructions.

A3 open discovery remains enabled. Additional clearly relevant facts remain `discovered`; Evidence does not mutate the request or schema.

---

## 6. Extraction context and opaque correlation

Extraction context is Evidence-facing interpretation input. R2 validates a bounded neutral shape, persists it with the run, and forwards only approved interpretation fields to the provider.

Opaque correlation is reconstructive caller metadata. Evidence validates only its bounded shape/size, persists and returns it, but does not interpret, dereference, authorize from, or forward it to the semantic provider.

Correlation must remain separate from:

* Evidence identity;
* Extraction Run identity;
* idempotency;
* requested concepts;
* extraction context;
* Evidence Information Needs; and
* policy/domain semantics.

Existing Extraction Run JSONB metadata is sufficient for bounded correlation. No migration is expected unless Architecture Authority later requires searchable/unique correlation semantics.

---

## 7. Artifact selection and authorization

R2 may interpret:

* one persisted Artifact; or
* an explicit coherent set of persisted Artifacts belonging to one Evidence Asset.

Cross-Evidence-Asset selection remains prohibited. Run-input lineage records every selected Artifact, while Fact-to-Artifact support records only the Artifact or Artifacts that actually support each Fact.

Public access remains governed by the existing public rule. Private access requires:

```text
context_restricted Asset
+ exact authorized tenant
+ exact authorized Evidence context
+ matching explicit Asset access scope
```

Authorization occurs before storage access or provider execution. Same-tenant membership alone is insufficient.

---

## 8. Media boundary

R2 does not add interpretation media.

Current supported media remain:

* `application/json` and compatible `+json`; and
* `text/html`.

An R1-preserved PDF, PNG, or JPEG remains valid stored Evidence but must receive explicit `unsupported_media_type` from R2 until R3 is separately authorized.

Artifact preservation success must never imply current interpretability.

---

## 9. Outcome model

Per requested concept, R2 must distinguish:

| Outcome | Meaning |
|---|---|
| `found` | supported Fact(s) answer the requested concept |
| `not_found` | interpretable, sufficiently complete input does not represent the requested fact |
| `not_evaluated` | incomplete/unreadable input or another limitation prevented evaluation |
| `unsupported` | current interpretation capability does not support the requested concept |

Operation/run outcomes must additionally distinguish:

* completed interpretation;
* completed but partial/incomplete interpretation;
* legitimate completion with no relevant Facts found;
* inconclusive interpretation;
* unsupported media;
* provider unavailable/not configured;
* malformed/truncated/timed-out provider result;
* storage read failure;
* Artifact integrity failure;
* access denial;
* cross-Asset input rejection; and
* persistence failure.

`unsupported` is not `not_found`; `not_found` is not provider failure; incomplete is not unavailable; and access/integrity/persistence failures are not “no data.”

No unsupported/failed result may fabricate a Fact.

---

## 10. Historical versus fresh execution

R2 exposes separate contracts:

```text
openInterpretationHistory(...)
  external source call: NO
  provider call: NO
  new run: NO

interpretArtifacts(...)
  external source call: NO
  provider call: MAYBE/YES
  new immutable run: YES
```

Selecting or resolving an Artifact, inspecting history, or round-tripping correlation must never trigger a provider call.

Historical output includes persisted requested-concept outcomes, Facts, support/completeness, input and Fact-support lineage, provider/model/instruction references, timestamps, failures, and opaque correlation.

---

## 11. Durable operation-key idempotency

Every stable fresh R2 request requires a caller-supplied `operationKey`. Historical reopening remains separate and requires no operation key. Correlation is not idempotency or run identity.

Within the trusted tenant/context/caller scope:

```text
same operationKey + same canonical request
  completed   → return existing result; provider NO; new run NO
  in_progress → return current status; provider NO; new run NO
  failed      → return persisted failure; automatic retry NO; new run NO

same operationKey + changed canonical request
  → idempotency_conflict

new operationKey
  → explicit new operation and immutable Extraction Run
```

The canonical fingerprint includes trusted tenant/context scope, authoritative resolved Artifact order, neutral requested concepts/descriptions/bounded Evidence linkage, validated extraction context, opaque correlation, and persisted trusted caller metadata. Provider/model/instruction configuration is excluded. The actual execution configuration remains persisted lineage.

R2 is authorized to add migration 015 as one forward-only interpretation-operation table with atomic scoped uniqueness, request fingerprint, bounded correlation, status, optional run reference, bounded failure, and timestamps. Migrations 010–014 remain immutable. No general workflow engine is authorized.

---

## 12. Stable response boundary

The R2 response should intentionally expose:

* run identity and status;
* safe Evidence Artifact/Asset identities;
* integrity result;
* requested-concept outcomes;
* requested and discovered Facts;
* explicit supporting Artifact IDs per Fact;
* input and extraction completeness/limitations;
* provider/model/instruction lineage;
* evidence-capture and extraction timestamps;
* bounded non-secret failure details; and
* opaque caller correlation.

It must not expose storage keys/references, credentials, provider prompts/raw responses, repository row shapes, Lab fixture defaults, or unbounded internal error objects.

---

## 13. Separation from A4a and consumer policy

R2 produces and retrieves A3 Evidence Facts. It does not automatically call A4a.

```text
R2 interpretation → Evidence Facts

separately:

A4a Fact-to-Information-Need evaluation
```

R2 does not select operative values, aggregate conflicts, assess coverage, determine satisfaction, calculate ownership, identify UBOs/controllers, mutate schemas, or import UBO/KYC/EDD/source-of-funds contracts.

---

## 14. Required future characterization

Before R2 can be accepted, separately authorized implementation must prove:

1. one persisted Artifact plus one requested concept;
2. one Artifact plus several requested concepts in one provider operation;
3. one operation producing several Facts;
4. requested and discovered Facts coexisting;
5. opaque correlation round-trip without provider exposure or domain adoption;
6. exact tenant/context authorization for private Evidence;
7. existing public Artifact interpretation remains permitted;
8. coherent same-Asset multi-Artifact interpretation;
9. cross-Asset selection rejected;
10. every Artifact SHA-256 verified before provider execution;
11. unsupported concept differentiated from legitimate not-found;
12. PDF/image reported unsupported before R3;
13. provider failure differentiated from no data;
14. history reopened without provider call;
15. deliberate fresh interpretation creates new immutable history;
16. Fact-to-Artifact support remains precise; and
17. no downstream policy/domain imports or automatic A4a action.

---

## 15. Stop conditions

Stop for Architecture Authority if R2 requires:

* idempotency semantics beyond the approved scoped operation-key contract;
* arbitrary cross-Evidence-Asset interpretation;
* weakening private tenant/context access;
* authoritative browser-supplied bytes or storage metadata;
* adopting foreign domain IDs as Evidence identities;
* a new general interpretation engine;
* PDF/image interpretation or locators;
* typed relational ownership Facts;
* automatic A4a evaluation;
* UBO/controller or KYC satisfaction logic;
* A4b; or
* rewriting migrations 010–014.

---

# Prior Accepted Build Brief — R1 Private Artifact Ingestion

The remainder of this file preserves the previously approved R1 brief for governance history. R1 was implemented at `0bd62ee351b6a1ac0ca2f882ac338d790657f313` and is not reopened by the proposed R2 governance.

---

## 1. Objective

Create the smallest production-capable generic Evidence boundary through which an already-authorized server-side private/customer upload can become immutable Evidence and later be reopened by an authorized server-side consumer.

```text
Authorized host upload
        ↓
Evidence private-artifact ingestion
        ↓
immutable context-restricted Evidence Asset
        ↓
immutable original-byte Artifact
        ↓
SHA-256 + media + provenance + timestamps
        ↓
strictly authorized server-side reopen
```

R1 preserves bytes and provenance. It does not interpret the document or decide what it proves.

---

## 2. Observed Existing Capability

The existing implementation already provides:

### Persistence

* `evidence_collection_operations` for producer/request operation identity, mode, status, coordinates, and lifecycle timestamps;
* `evidence_acquisitions` for tenant, context, subject, source, method, actor, outcome, and acquisition timestamps;
* `evidence_assets` for durable logical Evidence identity, subject, type/title, access class, and observation time;
* `evidence_asset_access_scopes` for tenant/context visibility;
* `evidence_artifacts` for Artifact identity, representation/media type, original name, storage provider/key/reference, exact size, SHA-256, capture time, and metadata; and
* forward-only transactional graph persistence through the A1/A2 repositories.

### Raw-byte storage

* `VercelBlobArtifactStore` is the current production storage adapter and writes private Blob objects;
* `FileArtifactStore` is the local Evidence-only adapter;
* `MemoryArtifactStore` and `fixture_content` are fixture/test mechanisms; and
* each adapter accepts opaque bytes independently of extraction support.

### Integrity and reopen

* `sha256()` calculates lowercase SHA-256 over exact bytes;
* A2 persists the calculated fingerprint and byte size with every Artifact;
* `EvidenceArtifactReader` reopens filesystem, private Vercel Blob, or fixture bytes server-side; and
* A2 history and A3 live interpretation demonstrate read-time SHA-256 verification before bytes are exposed or interpreted.

### Existing access model

* public Assets are structurally reusable subject to later policy;
* private/customer Assets use `access_class = context_restricted` plus an explicit tenant/context access scope;
* Acquisition carries tenant, context, and subject lineage; and
* Evidence context already belongs to a tenant and subject reference.

The current A3 interpretation repository also contains a same-tenant authorization shortcut. This is a bounded implementation defect against the existing private/context-restricted invariant, not a new architecture decision. It is not an acceptable private-reopen predicate for R1. R1 implementation is authorized to correct it narrowly while leaving public Evidence behavior unchanged.

---

## 3. Existing Domain Must Be Reused

R1 reuses the existing domain chain:

```text
Collection Operation
        ↓
Acquisition
        ↓
Evidence Asset
        ↓
Asset Access Scope
        ↓
Artifact
        ↓
Storage + SHA-256 + Provenance
```

Do not create parallel upload-document, blob, evidence, subject, context, access, provenance, fingerprint, or history concepts.

R1 creates no Evidence Requirement, Information Need, Extraction Run, extracted value, A3 Fact, verification attempt, A4a evaluation, or A4b assessment.

The implementation may add a generic `evidence/ingestion` module and service/repository interfaces. It may reuse or semantics-preservingly extract the existing Artifact-store implementation from its A2-oriented module location. It must not duplicate the storage adapters.

---

## 4. Proposed Service Boundary

The future service input is conceptually equivalent to:

```text
ingestPrivateArtifact({
  idempotencyKey,
  authorizedTenantId,
  authorizedContextId,
  subjectReferenceId?,
  actorType,
  actorId?,
  sourceChannel,
  sourceLocator?,
  bytesOrServerStream,
  declaredMediaType,
  originalFilename?,
  sourceEffectiveDate?
})
```

Exact names and transport remain implementation details.

The boundary receives an upload only after the host has authorized Evidence Platform custody. Tenant, context, and actor identity come from trusted server-side authorization/session context. A browser must not be able to assert an arbitrary tenant, context, actor, storage path, storage reference, fingerprint, or subject association.

The context must exist and belong to the authorized tenant. R1 derives its subject from that context. If a subject reference is supplied, it is a consistency constraint and must match the context; R1 does not resolve identity or create a new canonical subject.

The successful response may expose:

* Collection Operation ID;
* Acquisition ID;
* Evidence Asset ID;
* Artifact ID;
* canonical media type;
* byte size;
* SHA-256;
* ingestion/capture timestamp;
* explicitly supplied source-effective date; and
* safe provenance summary.

It must not expose storage credentials, private storage paths/keys/references, raw authorization context, or unrelated private Evidence.

---

## 5. Media Support and Validation

R1 must support storage/ingestion for at least:

| Media | Canonical MIME type | Minimum server-side signature check |
|---|---|---|
| PDF | `application/pdf` | PDF file signature |
| PNG | `image/png` | PNG binary signature |
| JPEG | `image/jpeg` | JPEG binary signature |

This is preservation support, not interpretation support.

The implementation must:

* accept bytes or a bounded server-side stream rather than a browser storage reference;
* enforce configured byte-size limits before unbounded buffering/storage;
* validate supported file signatures and reject declared-MIME/signature conflict;
* derive a canonical media type from the validated format;
* reject empty, malformed, unsupported, or forbidden media;
* preserve exact original bytes without transcoding, recompression, PDF rewriting, EXIF modification, or image normalization; and
* treat original filename as optional untrusted display metadata.

Filename sanitization must prevent path traversal, header injection, and use as a storage key. The filename does not establish content type, subject, evidence class, or authorization.

Use a generic representation type such as `original_upload` and a generic Evidence type such as `private_uploaded_artifact`. R1 must not create UBO-specific or other consumer-specific media classifications.

It is valid for R1 to preserve an Artifact that A3 cannot interpret. Unsupported interpretation is not unsupported storage.

---

## 6. Storage and Integrity Sequence

For a valid, authorized request:

1. validate operation identity, context, metadata, size, and media signature;
2. calculate SHA-256 over the exact input bytes;
3. store the exact bytes using the configured authoritative Artifact store;
4. read the stored object back through that storage boundary;
5. verify byte size and SHA-256 against the input calculation;
6. persist the Collection Operation, successful Acquisition, context-restricted Asset, access scope, and Artifact in one logical database transaction; and
7. return a non-secret Evidence identity/provenance summary.

No successful Artifact may be reported before read-back integrity and persistence succeed.

SHA-256 means only:

> The reopened Artifact bytes are byte-for-byte identical to the bytes accepted by R1.

SHA-256 is not Evidence identity, semantic equivalence, source trust, reuse permission, or access permission.

Physical deduplication is outside R1. A later optimization must not merge logical Evidence history or weaken private access isolation.

---

## 7. Idempotent Retry and Genuine Repeat Upload

R1 uses the existing producer/request-key uniqueness boundary with a neutral private-ingestion producer identity.

### Retry of one logical operation

The same idempotency key, tenant, context, provenance-affecting metadata, media, and SHA-256 identify the same intended upload operation.

Retry must:

* reopen or resume the existing operation;
* return the same logical operation/Acquisition/Asset/Artifact identities after success;
* make no second successful logical Evidence history; and
* never mutate a previously completed Artifact.

Using the same key with different tenant, context, bytes, canonical media, or material provenance metadata is an `idempotency_conflict`.

### Deliberate repeat upload/recollection

A deliberate new upload uses a new idempotency key and creates new immutable Collection Operation, Acquisition, Asset, and Artifact identities.

This remains true when:

```text
old SHA-256 = new SHA-256
```

Identical bytes do not automatically mean the same evidentiary event.

---

## 8. Private Access and Security

Every R1 Asset must be:

```text
access_class = context_restricted
```

and have an explicit access scope for its authorized tenant and Evidence context.

Authorized reopen requires all of:

* Artifact and Asset exist;
* Asset is context restricted;
* explicit asset scope matches authorized tenant;
* explicit asset scope matches authorized Evidence context;
* context belongs to that tenant;
* subject association remains the one persisted through the context/acquisition; and
* stored bytes pass SHA-256 verification.

Same tenant without the matching context is insufficient. Cross-context and cross-tenant private discovery/reuse are forbidden. Artifact IDs and fingerprints are not bearer tokens.

The identified A3 same-tenant shortcut must be corrected through this same invariant: context-restricted interpretation requires the exact authorized tenant and context. Do not broaden the correction into a new authorization model or change public Evidence access.

The future reopen boundary is conceptually equivalent to:

```text
readAuthorizedArtifact({ artifactId, authorizedTenantId, authorizedContextId })
```

It resolves metadata and authorization before storage access, reads only the persisted server-side storage location, verifies SHA-256, and returns bytes or an approved server-side stream to the authorized caller. Browser-facing inspection must not expose storage credentials or references.

R1 does not implement retention/deletion, malware scanning policy beyond bounded media validation, content-disarm/reconstruction, antivirus vendor selection, DLP, legal hold, or a general secret/biometric vault. If production security requires any of those before accepting a real consumer, that control must be separately authorized or supplied by the host boundary.

---

## 9. Provenance and Time Semantics

Successful ingestion preserves:

* Evidence Asset and Artifact identities;
* exact original bytes;
* canonical MIME type and byte size;
* optional sanitized original filename;
* Acquisition source channel/provider/locator where applicable;
* acquisition method;
* authorized actor type and identifier where available;
* tenant, Evidence context, and context-derived subject reference;
* private access scope;
* SHA-256 and algorithm;
* acquisition start/completion time;
* Asset observation time;
* Artifact capture/ingestion time; and
* an explicitly supplied source/document effective date.

These times must remain distinct:

```text
source-effective date (optional, host supplied)
≠ acquisition/upload time
≠ Artifact capture time
≠ database creation time
≠ future extraction time
```

R1 must not inspect the document to infer an effective date. It must not use client filesystem modification time as source-effective evidence. A supplied effective date is preserved under the canonical Evidence-owned `artifact_metadata.sourceEffectiveDate` property with its host-supplied provenance and ISO precision. It does not replace `captured_at` or `observed_at`, and it does not establish freshness or current applicability.

---

## 10. Failure Model

The service/API must distinguish at least:

| Failure | Meaning |
|---|---|
| `invalid_request` | required operation/media/context metadata is absent or malformed |
| `access_denied` | trusted authorization does not permit the tenant/context/subject operation |
| `unsupported_media_type` | format is not in the R1 preservation allowlist |
| `invalid_media` | bytes are empty, malformed, or conflict with declared media metadata |
| `idempotency_conflict` | an existing key is reused for materially different input |
| `artifact_storage_failed` | authoritative object storage did not accept or reopen the bytes |
| `artifact_integrity_mismatch` | stored bytes/length do not match the accepted input |
| `evidence_persistence_failed` | logical Evidence transaction did not commit |

Exact internal code spelling may follow repository conventions, but these meanings must remain separately observable without secrets.

None of these failures means:

```text
document contains no facts
```

R1 performs no extraction. A failed or denied request creates no successful Asset or Artifact. Where a failed Collection Operation or Acquisition can be safely and truthfully recorded, it must contain no fabricated evidence result. A persistence failure must not be reported as success even if object storage already contains an orphaned object.

Cleanup of an R1-created orphan storage object may be implemented only as a scoped operational mechanism that cannot delete any previously persisted Artifact or shared physical object.

---

## 11. Production Storage Boundary

Do not assume a new storage subsystem is required.

The minimum R1 implementation should reuse:

* private Vercel Blob for deployed production storage;
* the configured Evidence-only filesystem directory for local acceptance;
* memory/fixture storage only for tests; and
* the existing server-side reader for provider-specific reads.

The production API must fail closed when no approved durable Artifact store is configured. Memory storage and database `fixture_content` are not production fallbacks.

Storage provider selection remains an infrastructure configuration. It must not change Evidence identity, access class, provenance, or retry semantics.

---

## 12. Persistence and Migration Direction

The minimum R1 model is representable without a new migration:

* Collection Operation — migration 011;
* Acquisition, Asset, access scope, and Artifact — migration 010;
* media type and original filename — existing Artifact columns;
* actor/source provenance — existing Acquisition columns and producer metadata;
* source-effective date — canonical `artifact_metadata.sourceEffectiveDate`, distinct from capture time; and
* SHA-256, byte size, capture time, and storage lineage — existing Artifact columns.

Implementation must not rewrite migrations 010–014.

If repository implementation shows a new typed column or state is necessary to preserve these semantics, stop for Architecture Authority. Any approved migration must be additive and forward-only. R1 must not overload extraction or A4a tables.

---

## 13. Required Characterization

When separately authorized, R1 implementation must prove at minimum:

1. PDF ingest and authorized reopen are byte-for-byte exact;
2. PNG ingest and authorized reopen are byte-for-byte exact;
3. JPEG ingest and authorized reopen are byte-for-byte exact;
4. stored SHA-256 matches accepted and reopened bytes;
5. Artifact identity is immutable;
6. tenant/context-restricted visibility succeeds only for the exact authorized scope;
7. cross-context and cross-tenant reads are denied before storage access;
8. canonical media type, size, optional filename, and source metadata are correct;
9. upload/capture time and supplied source-effective date remain distinct;
10. malformed and unsupported media fail without Evidence conclusions;
11. storage, integrity, and persistence failure are separately observable;
12. an idempotent retry creates no second logical evidence event;
13. a deliberate new upload with identical bytes creates new immutable Evidence identities;
14. prior Artifact history is never mutated;
15. API responses expose no storage credentials/references; and
16. no extraction, Fact, evaluation, UBO, KYC, or A4b record is created.

Tests must use fixture bytes and disposable infrastructure. No paid AI request or external evidence-source call is required.

---

## 14. Explicit Exclusions

R1 does not implement:

* document extraction or interpretation;
* PDF text extraction, OCR, vision, or AI provider calls;
* Facts, derived Facts, support states, or verification;
* Evidence-to-Need evaluation;
* A4b coverage/conflict/provisional assessment;
* Requirement satisfaction;
* source trust or suitability;
* operative-value or winner selection;
* evidence reuse or discovery policy;
* private cross-context or cross-tenant access;
* UBO types, IDs, ownership claims, Information Needs, media types, or contract changes;
* KYC/KYB, EDD, source-of-funds, analyst, or other consumer workflow integration;
* creation or resolution of global subject identity;
* direct browser authority to select storage or access scope;
* external-custody IDV passport, selfie, or biometric retention;
* general identity/biometric vault design;
* retention/deletion policy;
* physical deduplication;
* R2, R3, or R4; or
* changes to existing KYC behavior.

---

## 15. Stop Conditions

Stop and report before R1 implementation proceeds if it would require:

* weakening exact tenant/context private access;
* trusting browser-supplied tenant, context, actor, subject, hash, bytes reference, or storage reference as authoritative;
* treating SHA-256 as logical identity or authorization;
* interpreting a document to ingest it;
* creating consumer-specific or UBO domain records;
* taking custody of external-custody IDV/biometric artifacts without separate governance;
* mutating an existing Asset or Artifact on retry or repeated upload;
* using upload time as an inferred document-effective date;
* reporting an extraction/no-facts conclusion for an ingestion failure;
* exposing private storage references or credentials;
* using memory/fixture storage as a production fallback;
* rewriting migrations 010–014;
* implementing A4b, R2, R3, or R4; or
* changing normal KYC/Pre-boarding/UBO behavior.

---

## 16. Future Completion Criteria

After separate implementation authorization, R1 is complete when the isolated Evidence boundary demonstrates:

```text
already-authorized private PDF/PNG/JPEG
        ↓
validated media + exact bytes
        ↓
private durable storage + read-back SHA-256
        ↓
immutable operation/acquisition/asset/artifact provenance
        ↓
exact tenant/context access scope
        ↓
authorized server-side reopen
        ↓
interpretation and downstream decision: NOT PERFORMED
```

Completion must prove idempotent retry and genuine identical-byte repeat uploads as different cases, preserve prior history, and leave R2/R3/R4, A4b, UBO, consumer integration, and existing KYC behavior untouched.
