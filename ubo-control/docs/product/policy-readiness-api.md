# Policy readiness API

Wave 1 adds one standalone, stateless public operation:

```js
const {
  UBO_POLICY_RUNTIME_MODE,
  assessUboPolicyPackReadiness,
} = require("ubo-control");

const assessment = assessUboPolicyPackReadiness({
  policyPack,
  runtimeMode: UBO_POLICY_RUNTIME_MODE.PRODUCTION,
  evaluationTime: "2026-09-03T12:00:00.000Z",
});
```

The result contract is `ubo-policy-readiness-v1`. It is provider-neutral JSON data, deeply immutable, and deterministic for the same inputs. It reports policy identity, readiness (`READY`, `REVIEW_ONLY`, or `BLOCKED`), production-blocking reasons, unresolved sign-offs, enabled optional features, unsupported algorithms, effective-period state, watermark requirement, and whether a new production determination is permitted.

`evaluationTime` is always explicit. No runtime mode consults the system clock.

## Modes

- `LAB` can assess review packs. A non-ready pack returns `REVIEW_ONLY` and `watermarkRequired: true`; Lab loading is not production approval.
- `PRODUCTION` returns `BLOCKED` unless policy/release status, effective period, approving authority, pack-declared mandatory and enabled-feature sign-offs, and algorithm compatibility are ready.
- `HISTORICAL_RECONSTRUCTION` requires `pinnedPolicyIdentity` with exact schema, policy ID/version, and canonical hash. It may verify a genuine historical review pack but always returns `newProductionDeterminationPermitted: false`. Supplying `intendedUse: "NEW_DETERMINATION"` is blocked.

When an out-of-band policy pin is available, `pinnedPolicyIdentity` may also be supplied in other modes to verify exact integrity. Schema and integrity failures use the stable `UboPolicyReadinessError` and `UBO_POLICY_READINESS_ERROR_CODE` surface.

## Production blocking rules

The guard reads sign-off IDs and feature dependencies from the Policy Pack. No Control Room `A-*` identifier is hard-coded. A disabled feature's open/deferred dependency is visible in `unresolvedSignoffs` but does not block solely because it exists. The same dependency blocks if its feature is enabled. Unreferenced sign-offs marked `productionBlocking` and mandatory sign-offs also block until approved.

## Compatibility boundary

This operation does not invoke or wrap Decision Application v1/v2 and does not change their exact operation sets. It does not create a DecisionSnapshot or run qualification, calculation, requirement resolution, planning, capability, provider, persistence, or host behavior.

UK Corporate 1.5-RC remains the immutable schema-1.2 Lab baseline with canonical hash `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790`. Repository-level legacy wording that describes UK/EU UBO as “25% or more” is non-authoritative for fresh successor UBO Control policy; it does not change historical behavior or the current 1.5-RC comparator.

UK Corporate 1.6-RC is an immutable schema-1.3 review-policy artifact with canonical hash `sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969`. It is not selected by the current Lab or Decision Application. Readiness assessment returns `REVIEW_ONLY` in LAB and `BLOCKED` in PRODUCTION because it is not approved/effective, required sign-offs are unsigned, and successor algorithms/contracts are unsupported. Assessment does not execute its doctrine.
