# UK Corporate 1.6-RC source mapping

## Artifact identity

| Field | Value |
|---|---|
| Policy Pack | `UBO-UK-CORPORATE` |
| Version | `1.6-RC` |
| Schema | `1.3` |
| Release status | `CONTROL_ROOM_REVIEW` |
| Effective from | `null` |
| Approved by | `null` |
| Supersedes | `1.5-RC` |
| Canonicalization | `ubo-canonical-json-v1` |
| Runtime canonical hash | `sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969` |
| Primary change-spec byte hash | `sha256:357310ae06a00641962156e4e1885927acf236bff848acdf23d28da792d19602` |

The runtime hash is SHA-256 over the parsed policy's `ubo-canonical-json-v1` representation, not the source-file bytes. The review pack is inspectable data only. It is not selected by the current Decision Application or Lab.

## Authority vocabulary

- **Legal source** means the legislation or statutory material named by the freeze package.
- **Supervisory guidance** means the JMLSG or PSC guidance profile named by the freeze package.
- **Control Room doctrine** means the approved product-design freeze; it is not legal or MLRO approval.
- **Practitioner/research evidence** may inform a pending sign-off; it does not approve that sign-off.
- **Pending sign-off** means the A-record remains non-approved until the required authority, date, effective date, scope and evidence are recorded.

## Doctrine and runtime mapping

| Policy section | Freeze source / Control Room decision | Legal or review reference | Sign-off | Current status | Future wave | Safe default |
|---|---|---|---|---|---|---|
| Identity and release metadata | File 02 §§1–2; Wave 2 §§1–4 | File 08 release rules | A-11 | Review only | Later release approval | Null effective date and approver; production blocked |
| Legal baseline | File 01 §2; File 02 §2; Wave 2 §5 | MLR 2017 as amended through SI 2026/621; JMLSG; in-force PSC guidance | A-08 | Research complete, sign-off pending | Legal approval | Baseline recorded without claiming the delta memo is approved |
| Machine-readable governance | File 08 register; Wave 2 §§6–7 | File 08 evidence requirements | A-01–A-18 | None approved | Per feature/release | Mandatory production IDs are A-08/A-09/A-10/A-11; disabled features do not independently block |
| Management-control route | File 01 §6.1; File 02 §3; Wave 2 §8 | MLR 2017 Reg 5(1)(a) | A-05 for fund/GP interpretation | Data declaration only | Wave 3 and specialist follow-up | Evidence/review method; no new executable rule |
| Effective-interest route | File 01 §6.2; File 02 §3 | MLR 2017 Reg 5(1)(b) | None for existing arithmetic | Adopted interpretation declared | Wave 3 internal wrapper implemented; runtime handoff deferred | Existing `ubo-percentage-lookthrough-v1`; no arithmetic change |
| PSC-condition attribution route | File 01 §6.3; File 02 §3 | MLR 2017 Reg 5(1)(c), 5(2)(a); CA 2006 Sch 1A | A-09; LLP also A-06; joint facts A-13; appoint/remove A-12 | Declared, unsupported | Wave 4; LLP later only after A-06 | No attribution result or qualification is produced |
| Statutory economic threshold | File 01 §4.1; File 02 §4 | MLR 2017 Reg 5(1)(b) | A-08 production baseline | Mandatory `>25` | Consumed by internal Wave 3 basis wrapper | Immutable policy threshold; no tenant lowering |
| Statutory voting threshold | File 01 §4.1; File 02 §4 | MLR 2017 Reg 5(1)(b) | A-08 production baseline | Mandatory `>25` | Consumed by internal Wave 3 basis wrapper | Kept separate from economic threshold |
| Firm collection threshold | File 01 §§4.2–4.3; File 02 §4 | Firm-policy concept | Firm approval if enabled | Disabled | Internal overlay supported; activation and runtime wiring deferred | Null threshold in this pack; test-only enabled fixture proves it cannot suppress statutory status |
| Firm layer-holder collection | File 01 §6.5; File 02 §5 | Firm SOP required | A-18 | Deferred, disabled | Deferred | No runtime behavior; separate firm-policy role only |
| Layer completeness | File 01 §5; File 02 §6 | Control Room doctrine | A-03/A-13 where evidence or joint facts matter | Declared, unsupported | Wave 6 | No closure arithmetic; `ubo-layer-closure-v1` required |
| Percentage evidence states | File 01 §5.3; File 02 §7 | Control Room evidence doctrine | A-03 | Declared | Wave 6 | In-band exact declaration is corroborated, never exact verified |
| Decision-sensitive precision | File 01 §5.4; File 02 §6 | Control Room doctrine | A-03 | Declared | Wave 6 | Exactness only when a live determination can change |
| Control action gating | File 01 §7; File 02 §8 | MLR/PSC control conditions | A-04 and A-17 for customer content | Last-resort gated; numeric questions disabled | Waves 8–11 | Subject assessed; no generic intermediary questioning |
| Residual confirmation bundle | File 01 §7.5; File 02 §9 | Product doctrine; wording not approved | A-02 and A-17 | Disabled | Wave 11 | One future interaction, separately stored statements, no automatic resolution |
| Customer-listed case | File 01 §8.1A; File 02 §10 | Intended MLR 2017 Reg 28(5) authority | A-14 | Blocked/review-only | Later listed routing | Requires qualifying market plus listing/disclosure evidence |
| Listed consolidated-subsidiary case | File 01 §8.1B; File 02 §10 | Current JMLSG treatment requires confirmation | A-07 | Disabled | Later listed routing | No automatic treatment without all evidence and sign-off |
| Intermediate listed-parent terminus | File 01 §8.1C; File 02 §10 | Optional firm/product doctrine | A-01 | Deferred, disabled | Deferred | OFF; no generic listed short-circuit |
| Exhaustion categories/dispositions | File 01 §§8.2–8.3; File 02 §11 | MLR 2017 Reg 28 fallback record | A-10 | Declared, not executable | Wave 9 | Current asynchronous fallback unchanged; no universal checklist |
| Structure acquisition | File 01 §9; File 02 §12 | Product/planner doctrine | A-15 for predictive capability claims | Strategies declared | Wave 9 | Charts create candidates, not proof; provider capabilities stay outside policy |
| Phased evaluation | File 01 §12; File 02 §13 | Control Room architecture doctrine | None | Declared, unsupported | Wave 7 | A phase consumes only supported own/earlier-phase inputs |
| Successor runtime compatibility | File 09 §§E–G; Wave 2 §18 | Architecture version map | A-09 and later implementation acceptance | Unsupported dependencies visible | Waves 3–10 | Decision Application v1/v2 and snapshot/projection v1 unchanged |
| Customer action content | File 02 requirement/action material; Wave 2 §20 | Control Room successor-policy decision for `DISCLOSE_SHARE_OWNERSHIP` | A-17 for missing content | One approved carried-forward contract; unresolved content remains blocked | Wave 11 | No generic replacement prose |
| Lifecycle events | File 02 §17; Wave 2 §21 | Historical source references E01/E02/E08/E10 unresolved | A-16 | Disabled | Later semantic-event wave | Opaque codes stay unresolved and non-executable |
| Runtime isolation | Wave 2 §23 | Wave 1 readiness boundary | A-11 | Protected now | Later explicit composition | Current Lab and Decision Application continue selecting/using 1.5-RC |
| Assertion inventory | File 07 §§3–16; Wave 2 §25 | Control Room test freeze | Per assertion | Classified, not overclaimed | Waves 3–11/deferred | `test-assertion-plan.json` distinguishes current protection from future work |

## R01–R14 successor intent

| Requirement | Freeze source | Sign-off | Status / future wave | Safe default |
|---|---|---|---|---|
| R01 | File 02 §15 R01; File 09 §H | A-03/A-09/A-06 as applicable | Wave 8 after routes/closure | Regulated-subject intent only; no intermediary fan-out execution |
| R02 | File 02 §15 R02; File 09 §H | None | Wave 7/8 | Graph-derived intent declared; current caller placeholder is not used by v1.6 execution because execution is absent |
| R03 | File 02 §15 R03; File 09 §H | Evidence policy later | Wave 7/8 | Entity, relationship and source independence remain distinct |
| R04 | File 02 §15 R04; File 09 §H | A-04; attribution A-09/A-06 | Wave 8 | Subject-level assessment; intermediary and numeric actions gated |
| R05 | File 02 §15 R05; File 09 §H | A-12; customer content A-04/A-17 | Wave 8 | Preserve combined source semantics; require majority scope |
| R06 | File 02 §15 R06; File 09 §H | A-02/A-17; fund/GP A-05 | Waves 3/8/11 | Positive supported fact or review; negative residual leg disabled |
| R07 | File 02 §15 R07; File 09 §H | A-17 | Wave 7/8/11 | Applicability derives from future actual qualification; only missing UBO attributes |
| R08 | File 02 §15 R08; File 09 §H | A-03 | Wave 6/8 | One structure-level need; one artifact is one source |
| R09 | File 02 §15 R09; File 09 §H | Later legal/operating acceptance | Wave 8 | Taxonomy declared in description/tests; no report candidate or submission |
| R10 | File 02 §15 R10; File 09 §H | A-10 | Wave 9 | Current asynchronous fallback unchanged; NO_DATA is never exhaustion |
| R11 | File 02 §15 R11; File 09 §H | A-02/A-17; A-05 where specialist fund facts arise | Waves 8/11 | Positive signal independent; unsigned negative statement disabled |
| R12 | File 02 §15 R12; File 09 §H | A-02/A-17; A-13 where joint facts arise | Waves 8/11 | Positive signal independent; unsigned negative statement disabled |
| R13 | File 02 §15 R13; File 09 §H | None | Wave 7 | UBO risk signals only; no host-risk mutation |
| R14 | File 02 §15 R14; File 09 §H | A-02/A-17 | Wave 11 | Disabled final statement cannot cure unresolved requirements |

## Feature dependency defaults

| Feature | Enabled | Required sign-off(s) | Meaning |
|---|---:|---|---|
| Company PSC attribution | Yes, declaration only | A-09 | Required successor route is visible but blocked by unsupported `ubo-psc-attribution-v1` and pending sign-off |
| LLP PSC attribution | No | A-06, A-09 | No LLP/TDR conclusion |
| Joint-arrangement attribution | No | A-13 | No inference from aligned interests |
| Automatic appoint/remove qualification | No | A-12 | Preserve source fact; no automatic majority conclusion |
| Residual confirmation bundle | No | A-02, A-17 | No statement resolves automatically |
| Numeric customer control questions | No | A-04, A-17 | No numeric control question activates |
| Customer-listed route | Yes, review-only | A-14 | Route is declared but production-blocking until evidence rule approval |
| Listed consolidated-subsidiary route | No | A-07 | No automatic treatment |
| Intermediate listed-parent terminus | No | A-01 | Deferred and OFF |
| Predictive RegistryCapabilityProfile planning | No | A-15 | No entitlement/capability prediction |
| Semantic lifecycle events | No | A-16 | E-codes remain unresolved |
| Firm layer-holder collection | No | A-18 | Deferred and no runtime behavior |
| Declaration-band operational sufficiency | No | A-03 | Corroborated is not exact verified |
| Fund/GP deterministic management control | No | A-05 | Specialist review remains safe default |

No Claude review, practitioner input, test result, or Control Room design freeze is represented here as legal or MLRO approval.
