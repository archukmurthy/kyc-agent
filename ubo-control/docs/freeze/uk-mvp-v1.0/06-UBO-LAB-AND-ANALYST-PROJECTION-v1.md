# 06 — UBO Lab and Analyst Projection v1

**Status:** CONTROL ROOM PRODUCT FREEZE  
**Purpose:** Make the reasoning inspectable without confusing diagnosis with applicant UX

---

# 1. Lab role

The Lab is the Control Room/compliance microscope.

It exposes:

- source facts;
- identity and claim decisions;
- graph;
- qualification routes;
- requirements;
- evidence states;
- causal InformationNeeds;
- ResolutionPlan;
- customer work;
- reviews;
- DecisionSnapshot history.

It is not the applicant journey.

---

# 2. One primary graph

Show one subject-centred graph per workspace.

Default view:

- economic ownership spine;
- upstream holders above;
- regulated subject at bottom;
- one canonical entity = one node;
- relevant unresolved frontier retained;
- disconnected research/candidate entities excluded from the main map.

Candidate/investigation universe remains available in another panel.

---

# 3. Control overlays

Provide filters/toggles:

- Ownership;
- Voting;
- Control;
- All.

Default to Ownership.

Inside nodes/details, show concise control badges where relevant.

Do not draw four overlapping arrows everywhere by default.

---

# 4. Edge status vocabulary

Replace blanket “entity unresolved” with edge/fact states:

- VERIFIED;
- CORROBORATED;
- DECLARED;
- CONTRADICTED;
- STALE;
- UNKNOWN;
- REVIEW_REQUIRED.

An identified entity is not “unresolved” merely because one dimension is incomplete.

---

# 5. Node status vocabulary

Node-level semantics may include:

- SUBJECT;
- QUALIFYING_PERSON;
- FIRM_POLICY_PERSON;
- NOT_CONFIRMED_UBO;
- FRONTIER_ENTITY;
- SPECIAL_STRUCTURE;
- REVIEW_REQUIRED;
- IDENTITY_UNRESOLVED.

Do not use `UNRESOLVED_ENTITY` for a company with established identity and ownership but incomplete voting evidence.

---

# 6. Selection semantics

Selecting a node:

- highlights direct relationships;
- highlights relevant downstream route to the subject;
- shows incoming/outgoing relationships;
- shows qualification and open causal needs.

Selecting an edge:

- isolates that relationship;
- brings label to front;
- shows basis/value/currentness/evidence/claim status.

Selecting a qualification:

- traces requirement → method → calculation/attribution → path/rights → evidence.

Clear selection via:

- background click;
- Escape;
- repeat click;
- visible clear control.

---

# 7. Fit and large graphs

Controls:

- Fit width;
- Overview/Fit all;
- zoom/pan/reset.

Do not shrink a large graph to illegibility as the default.

Use readable node dimensions and scrollable/zoomable workspace.

---

# 8. Unresolved inspection

The unresolved summary opens a deterministic list, not a random node.

Group by causal need:

- target;
- concept/dimension;
- requirement(s);
- edge/frontier;
- current resolution source;
- who can act;
- dependent calculations/paths.

Do not count dependent path diagnostics as new needs.

Display separate counts for:

- open causal needs;
- customer work items;
- internal reviews;
- affected paths.

---

# 9. Requirement view

For R01–R14 show:

- applicability;
- state;
- legal/policy basis;
- qualifying route;
- evidence state;
- causal needs;
- resolving action/review;
- history.

Derived applicability uses the phased engine, not caller-supplied placeholders.

---

# 10. Qualification explanation

For each person show:

- statutory or firm-policy status;
- all qualifying bases;
- route/limb;
- dimension/condition;
- direct/indirect;
- calculation or attribution trace;
- policy version;
- evidence/support;
- unresolved alternative bases.

No naked “UBO” badge without explanation.

---

# 11. Effective interest versus attribution

Display separately:

- Effective-interest result;
- Schedule 1A attribution result;
- management-control result.

Example:

> Effective economic interest: 24% — does not satisfy percentage route.  
> Schedule 1A attribution: satisfied through majority-stake chain — statutory beneficial owner.

Do not imply the methods are competing calculations of the same number.

---

# 12. Evidence presentation

Per edge show:

- source;
- Artifact/EvidenceReference;
- fact locator;
- currentness;
- declared/corroborated/verified status;
- contradictions;
- freshness.

A registry band and customer exact declaration must remain separately visible.

---

# 13. ASDA view

Expected:

- 12 canonical entities, no duplicate IDs;
- economic chain readable;
- TDR individuals shown with voting `(25%,50%]`, not economic ownership;
- TDR governance frontier clearly identified;
- no blanket unresolved badge on every company;
- no double-counted 35-item display;
- approximately 2–4 coherent customer interactions as a benchmark;
- final TDR attribution status marked provisional until sign-off.

---

# 14. Decision consoles

Retain explicit:

- identity resolution;
- entity registration;
- claim adjudication;
- conflict review;
- fallback exhaustion review.

Do not auto-resolve uncertain decisions for visual neatness.

---

# 15. History

Every snapshot view preserves historical:

- policy;
- algorithms;
- graph;
- qualifications;
- needs;
- plan;
- reviews;
- terminal state.

Do not recalculate old snapshots with new doctrine.

---

# 16. Lab policy safety

Review packs may run only with visible watermark:

> REVIEW POLICY — NOT APPROVED FOR PRODUCTION

Production-approved packs require effective date, approver and no blocking sign-offs.

---

# 17. Feedback capture

Feedback records:

- snapshot hash;
- selected entity/edge/requirement;
- category;
- note;
- doctrine version;
- Lab mode;
- provider/replay/fixture provenance.

Practitioner feedback remains research evidence until Control Room approval.

---

# 18. Applicant preview

The Lab may include an applicant-preview tab.

It must use the actual JourneyProjection/ResolutionPlan and never the full analyst graph by default.

This keeps product testing honest.
