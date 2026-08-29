# G1.2B scenario corpus index

The corpus is internal test infrastructure, not a public Scenario DSL. Every fixture is data-only, validates through the production capability/party/fact/percentage/evidence validators, and records future reasoning only as `NON_EXECUTED_FUTURE_ACCEPTANCE` metadata.

## Core scenarios

| ID | Scenario | Contract surface |
|---|---|---|
| S01 | Direct company economic ownership | COMPANY share qualifier, direct exact economic fact, fact evidence |
| S02 | Direct LLP economic interest | LLP surplus-asset qualifier, exact economic fact |
| S03 | Multilayer company ownership | Directed multi-layer facts, evidence subsets, multiple operation references |
| S04 | Multiple independent paths | Four uncollapsed path facts; no aggregation |
| S05 | Cross-border unresolved corporate layer | Foreign legal entity, PARTIAL, no invented natural person |
| S06 | Discovery NO_DATA | Successful no-data outcome with no negative fact |
| S07 | Discovery operational failures | Sequential UNAVAILABLE and FAILED outcomes |
| S08 | Partial discovery | Useful fact plus unresolved requested concepts |
| S09 | Conflicting ownership candidates | Different percentages/evidence and same-name distinct parties |
| S10 | Threshold-crossing range | RANGE bounds and endpoint flags; no qualification |
| S11 | Customer document fills branch input | Discovery then Extraction for one need; no joining |
| S12 | Partial extraction | PARTIAL with UNKNOWN percentage and unresolved concepts |
| S13 | Extraction failure | FAILED with external artifact reference and no negative fact |
| S14 | Voting versus economic basis | Separate VOTING_RIGHTS and ECONOMIC_OWNERSHIP facts |
| S15 | Appointment/removal control | COMPANY board and LLP management concepts remain distinct |
| S16 | Other significant influence/control | Ambiguous first-class control candidate; no review decision |
| S17 | Trust/special structure | TRUST, SETTLOR, and TRUSTEE relationships |
| S18 | Cycle | Directed cycle retained; no calculation |
| S19 | Duplicate relationship evidence | Separate Discovery/Extraction candidates; no deduplication |
| S20 | Listed entity/out-of-scope context | Listed profile and policy route data; no routing engine |

## Policy-focused input fixtures

| ID | Scenario | Deferred policy behavior |
|---|---|---|
| P01 | Declaration and independent corroboration | Evidence sufficiency and independent-source rules |
| P02 | PSC positive evidence and PSC absence | Candidate-claim and negative-resolution semantics |
| P03 | Senior-managing-official fallback preconditions | Fallback eligibility and decision snapshot |
| P04 | Nominee arrangement | Underlying-interest reasoning and role projection |
| P05 | Residual completeness attestation | Permitted/sufficient completeness closure |
| P06 | Qualifying-person identity handoff | Downstream identity collection/verification |
| P07 | Discrepancy comparison | Definition mismatch, materiality, rationale, and reporting |
| P08 | High-risk negative attestation | Attestation closure restriction and documentary gap |

The complete 22-assertion mapping is machine-readable in `policies/uk-corporate/1.3-rc/test-assertion-plan.json` and governed in `TEST_MATRIX.md`.
