# Internal DecisionSnapshot v2 and history contract

Wave 7 introduces no public API. Internal callers may use `application/evaluateUboDecisionV3Review.js` only with a sealed OwnershipCase revision, schema-1.3 policy data, `runtimeMode: LAB`, an explicit evaluation time, target-bearing case context and checkpoint reference.

The result contains the exact nine immutable phase artifacts and one `ubo-decision-snapshot-v2`. Phase 7 and Phase 8 are explicitly transitional v1 compatibility stages. The pinned plan is created before the snapshot; the returned plan is the same immutable semantic artifact stored in the snapshot. Registry capability state is explicitly `NOT_PROVIDED`.

`domain/decisionHistoryV2.js` is the internal version dispatcher. It delegates v1 snapshots to the untouched v1 verifier/reconstructor and v2 snapshots to v2 verification/reconstruction. Reconstruction returns recorded content and never calls current reasoning algorithms, provider capabilities or evidence collection. Cross-version succession requires a linear predecessor and an explicit neutral reason: `POLICY_CHANGED`, `ALGORITHM_CHANGED`, `NEW_FACTS`, `REVIEW_DECISION` or `CUSTOMER_INPUT`.

The current public `createUboDecisionApplication`, `planUboResolution`, graph/journey projections and Lab accept only their existing versions. They do not select or consume Snapshot v2.
