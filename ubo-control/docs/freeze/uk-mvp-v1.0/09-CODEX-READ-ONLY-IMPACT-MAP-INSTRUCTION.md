# 09 — Codex Read-only Impact Map Instruction

## Control Room context

The attached UBO Control UK MVP Freeze Pack v1.0 is now the proposed authoritative design source.

Do not implement it yet.

Your next task is a **read-only impact map** against the current head of PR #45 / latest fresh UBO branch.

No code, policy, test, migration, adapter or UI changes.

Do not commit implementation.

---

# 1. Authority

Read in this order:

1. File 01 master doctrine.
2. File 08 sign-off register.
3. Files 02–07.
4. Existing UBO architecture/ADRs/tests.

Where earlier repository documentation conflicts with the freeze pack, report the conflict. Do not decide it yourself.

---

# 2. Current-state verification

Confirm:

- exact current commit;
- PR #45 state;
- current Policy Pack ID/version/schema/hash actually used by Lab;
- current public API versions;
- current test totals;
- current uncommitted changes/worktree status;
- Evidence workstream status only insofar as known from main; do not touch its worktree.

---

# 3. Impact map

For every frozen change, report:

- current module/file;
- current behavior;
- target behavior;
- keep unchanged / modify / replace / add;
- public contract effect;
- Policy Pack/schema effect;
- snapshot/history compatibility;
- test impact;
- sign-off dependency;
- migration/data compatibility;
- risk.

Cover at minimum:

- qualification basis model;
- PSC/Schedule 1A attribution;
- layer closure;
- firm threshold overlay;
- phased evaluation;
- R01–R14 rescoping;
- frontier InformationNeeds;
- projection deduplication/status vocabulary;
- RegistryCapabilityProfile;
- chart-assisted pivot;
- residual bundle;
- listed treatment;
- SMO measure categories;
- R09 mismatch taxonomy;
- runtime policy approval guard;
- applicant/Lab projections.

---

# 4. Preserve versus change

Produce two explicit lists.

## Preserve unchanged

Identify existing modules/tests that already satisfy the freeze.

## Change required

Identify exactly where current behavior conflicts.

Do not propose a rewrite where additive/refactoring change is sufficient.

---

# 5. Public contracts

Identify any change to:

- Policy Pack schema;
- Decision Application;
- DecisionSnapshot;
- OwnershipGraphProjection;
- JourneyProjection;
- ResolutionPlan;
- UI contracts.

For each proposed public change, recommend:

- additive same version;
- new version;
- internal-only;
- no change.

Do not implement.

---

# 6. Historical compatibility

Explain how:

- old v1.5-RC snapshots remain reconstructable;
- new algorithm/policy versions coexist;
- Lab replay records behave;
- old adapters continue working;
- current PR #45 fixtures are migrated or retained.

---

# 7. Test gap map

Map every File 07 required case to:

- existing passing test;
- existing test needing changed expectation;
- new test required;
- blocked by sign-off;
- deferred.

Do not simply count tests.

---

# 8. ASDA delta

Using the current sanitized ASDA case, report current versus expected under the freeze:

- graph facts preserved;
- qualification routes currently missing;
- current InformationNeeds and customer actions;
- expected causal frontier/edge needs;
- expected planner acquisition strategy;
- provisional/sign-off points;
- Lab presentation changes.

Do not hard-code a final UBO answer.

---

# 9. Recommended implementation sequence

Propose small PRs with hard seams.

For each PR give:

- objective;
- files/modules;
- tests;
- acceptance criteria;
- dependencies;
- sign-off prerequisites;
- rollback/compatibility risks.

Do not enter a later PR automatically.

---

# 10. Required output

Return:

A. Executive impact verdict  
B. Preserve list  
C. Conflict/change list  
D. File/module mapping  
E. Public-contract/version map  
F. Policy Pack/schema map  
G. Snapshot compatibility plan  
H. R01–R14 impact  
I. InformationNeed/planner impact  
J. Lab/customer journey impact  
K. Test gap matrix  
L. ASDA delta  
M. Proposed PR sequence  
N. Sign-off blockers  
O. Repository/worktree confirmation

Then stop.

Do not implement until Control Room authorises the first PR.
