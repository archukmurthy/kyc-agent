# UBO journey hypothesis register

This register records product research hypotheses and their Control Room product decisions. Entries are not regulatory authority or Policy Pack content. Source evidence `PRACTITIONER-001` remains explicitly classified `PRACTITIONER_EVIDENCE` with `NON_POLICY` authority; approved statuses below authorize only the stated product behavior.

## JH-001 — Suppress unnecessary customer questions

**Statement:** A customer question should normally be suppressed when the relevant policy requirement has already been resolved to the required evidential standard.

**Status:** `SUPPORTED / APPROVED PRODUCT BEHAVIOR`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gate 5 — Journey Design`

**Caution:** This does not change the underlying requirement itself.

## JH-002 — Governance documents are targeted resolution evidence

**Statement:** Articles, shareholder agreements, LLP agreements and similar governance documents should generally be requested to resolve specific outstanding InformationNeeds rather than universally requested from all applicants.

**Status:** `SUPPORTED / APPROVED PRODUCT BEHAVIOR`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gates 4–5`

**Caution:** Document sufficiency/certification remains governed by applicable policy.

## JH-003 — Ownership charts are primarily navigational/declarative

**Statement:** A customer ownership chart should normally be treated as a candidate description/navigation aid unless applicable policy determines that it provides sufficient proof for the relevant requirement.

**Status:** `SUPPORTED / APPROVED PRODUCT BEHAVIOR — POLICY-OPTION-GATED`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gates 4–5`

**Caution:** Do not automatically treat an ownership chart as independently corroborative evidence.

## JH-004 — Rare control complexity should be progressively disclosed

**Statement:** The engine should support the complete ownership/control model while customer-facing voting, appointment-right, share-class and significant-control questions should appear only when case state and policy make them necessary.

**Status:** `SUPPORTED / APPROVED PRODUCT BEHAVIOR`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gate 5`

**Caution:** Capability breadth must not become questionnaire breadth.

## JH-005 — Fact-led rather than document-led resolution

**Statement:** Journey progression should be organized around unresolved required facts/InformationNeeds rather than around completion of document checklists.

**Example:**

```text
Policy requires Fact X
→ already established?
→ Discovery?
→ already-held evidence/extraction?
→ permitted lightweight response?
→ targeted evidence request?
→ analyst/specialist?
```

**Status:** `SUPPORTED / APPROVED PRODUCT BEHAVIOR`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gates 4–5`

**Caution:** A document may support multiple requirements independently.

## JH-006 — Candidate resolution priority

**Approved v1 tier/wave doctrine:**

0. already-resolved or already-established information creates no work;
1. currently actionable zero-customer-friction routes form a system wave;
2. currently known necessary customer work is minimized and coalesced;
3. internal or specialist review follows where policy/current state requires it;
4. terminal outcome remains owned by the DecisionSnapshot.

Discovery and interpretation of already-held artifacts share the zero-customer-friction tier. Neither has a universal precedence; independently actionable routes may appear in the same wave. Operational planning never changes policy permission or evidence sufficiency.

**Status:** `APPROVED V1 PRODUCT PLANNING PRINCIPLE`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gate 5 — Resolution/Journey Design`

**Caution:** This is the pinned `ubo-low-friction-planner-v1` operational planning profile, not regulatory authority, a numeric friction score, provider ranking or a rigid capability sequence.

## JH-007 — Registry availability is dynamic

**Statement:** Journey/resolution logic should treat registry/source availability as a runtime capability outcome rather than a static property of a jurisdiction.

**Status:** `HYPOTHESIS / PRODUCT PRINCIPLE`

**Source evidence:** `PRACTITIONER-001`

**Target gate:** `Gates 3–5`

**Caution:** Do not encode rules such as `UK = available` or `Netherlands = unavailable`.

## Cross-cutting document/fact hypothesis

> `Document checked = YES` is not a UBO resolution state.

One artifact may yield several candidate facts, each affecting a different policy requirement. Capturing those candidate facts does not itself evaluate or resolve R04, R05 or R06.

## Practitioner research backlog

The unanswered research questions supporting these hypotheses are retained in [PRACTITIONER-001](../research/practitioner/PRACTITIONER-001-ubo-operational-resolution.md#practitioner-research-backlog). They are not implementation requirements.
