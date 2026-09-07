# UBO review application v1

Import the review surface from `ubo-control/review`. Its exact operation set is:

- `intake`: accepts the same provider-neutral capability result as Decision Application v2 and returns sealed case state plus explicit identity/adjudication targets.
- `applyDecisions`: applies explicit canonical registration, identity resolution/rejection/unresolved decisions and claim adjudication. It never performs fuzzy matching or automatic adjudication.
- `evaluate`: accepts only `LAB`, schema-1.3 review-compatible policy, explicit evaluation time and resolved targets. It returns DecisionSnapshot v2, its exact pinned ResolutionPlan v2, OwnershipGraphProjection v2, policy readiness and governance.

The factory has no `applyCustomerInput`, capability execution, policy mutation or persistence operation. Production requests fail with typed `UboReviewError`. UK Corporate 1.6-RC remains review-only and production-blocked.

The entry exports only the factory, projection function, review policy constant, contract/projection version constants and typed review error/error-code values. Phase functions, planners, constructors and validators remain private.

