# IDV measured metric semantics

Definition version: `idv-metrics-v2.0.0`. Source label:
`OUR_MEASURED_METRIC`. Executable definitions live in
`idv/services/metricDefinitions.js`; completeness is contract-tested.

Every metric response includes availability, value, numerator, denominator,
sample size, definition version, measurement source, unavailable reason, and a
low-sample warning below 30 observations. Small samples display whole-number
percentages. An unavailable provider stage is never presented as zero.

## Outcome metrics

| Metric | Numerator | Denominator / special treatment |
|---|---|---|
| Hosted-flow launch | Unique redirect-proxy events | Created sessions; explicitly limited because vendor render is unobserved |
| Journey terminal completion | Unique VERIFIED/FAILED/ABANDONED/EXPIRED terminal sessions | Launched sessions |
| Successful verification | Unique VERIFIED terminal sessions | Launched sessions; distinct from completion |
| Genuine-user first-time verification | Independently genuine-labelled, valid-opportunity, VERIFIED sessions without observed retry | Independently genuine-labelled sessions with valid technical opportunity; unavailable without labels |
| Abandonment | Unique abandonment sessions | Launched sessions |
| Technical failure | Unique technical-failure sessions | Launched sessions |

Provider approval never creates a genuine label. Pre-opportunity failures are
excluded only through `valid_technical_opportunity=false`; post-launch
abandonment remains in the genuine cohort denominator when labelled eligible.

## Attempt and friction metrics

Document first-pass/recapture, selfie retry, liveness first-pass/retry,
face-match first-pass, generic resubmission, and average attempts require the
relevant provider telemetry to include complete attempt/stage coverage. They are
`UNAVAILABLE` when coverage is absent. Face-match failure is derivable from an
observed normalized result even when attempt count is unavailable.

Retries are deduplicated by canonical session. Repeated webhook deliveries do
not create extra sessions. Generic retry events are not silently labelled as
document retries.

## Latency metrics

Nearest-rank p50/p90/p95/p99 plus average and sample size are reported for:

- launch to document submission;
- launch to extracted data;
- document submission to verification result;
- selfie submission to face-match result;
- launch to provider decision;
- provider decision to platform result receipt;
- launch to canonical terminal completion.

Provider decision, platform receipt, browser return, and canonical completion
timestamps are separate. Proxy/observed/exact timestamp source is retained.
Negative durations or missing pairs are excluded; a metric with no valid pairs
is unavailable. Launch-based durations are marked limited because redirect
issuance is a proxy for vendor-page opening.

## Extraction confirmation

Unique `(session, attribute_id)` presentations are joined to one customer
response. Confirmation rate is confirmed responses divided by all responded
presented attributes; correction rate uses corrected responses. Rejections are
neither confirmations nor corrections. Per-concept confirmation/correction is
returned for first name, last name, DOB, nationality, address, document number,
and any future canonical concept actually presented. Values never enter the
metrics dataset.

## Cost

The cost ledger stores provider/workflow/module, billing trigger, currency,
source/version, and basis `ESTIMATED` or `ACTUAL_CONFIRMED`. Actual entries take
precedence for a session. Estimates are never called actual. Mixed currencies
are unavailable without configured conversion. Partial pricing coverage is
unavailable rather than silently undercounted.

Cost per started uses all launched cost divided by launches. Cost per completed
and per successful use all launched cohort cost—including billable failures or
abandonments—divided by terminal or VERIFIED outcomes respectively.

## Dimensions and POC scorecard

All reports can be bounded by trusted tenant and half-open time period and sliced
by provider, workflow/version, country, issuing country, document type, device,
liveness method, database state, NFC state, test-case ID, and POC cohort. The
scorecard discovers registered providers dynamically; Didit and Veriff are not
hard-coded report rows.
