# ADR 0027: Review-only LLP and mixed COMPANY/LLP PSC attribution

## Status

Accepted for Freeze Implementation Wave 5 architecture under `A-06-WA-01`; legal and MLRO validation remains pending.

## Decision

UBO Control implements `ubo-llp-psc-attribution-v1` as a separate, replaceable, pure internal mapping with immutable `ubo-llp-psc-attribution-assessment-v1` output. It consumes the unchanged operative canonical graph and entity profiles. The company-only Wave 4 algorithm is not modified.

For LLP targets, surplus-asset, voting, majority-management appointment/removal and explicit unambiguous SIoC conditions remain distinct. An LLP surplus-asset right is never relabelled as a company share. Mixed paths may traverse COMPANY and LLP intermediaries, but an LLP majority step requires explicit strict `>50%` voting or explicit majority-scope appointment/removal. Economic interests and generic SIoC never imply majority control. Agreement/dominant-control semantics remain unsupported until the canonical vocabulary can represent them faithfully.

Indirect attribution preserves the full target right without percentage multiplication. Each target right is counted once while every supporting chain remains traceable. Separate people's interests are not summed. Explicit joint signals add A-13, require review and produce no positive attribution.

All output retains `A-06-WA-01`, `REVIEW_ONLY`, `productionAuthorized=false` and A-06. Company Schedule 1A semantics add A-09; appointment/removal adds A-12. The TDR fixture deliberately distinguishes direct LLP qualification from intermediary majority control: `(25%,50%]` voting may satisfy a direct LLP condition but cannot establish an ASDA attribution chain.

## Consequences

Trust/firm condition 5, ordinary partnership/fund LP traversal, joint attribution and a final TDR/ASDA person conclusion remain unimplemented. The immutable UK Corporate 1.6-RC Policy Pack and its A-06 status do not change. Decision Application, current Lab/ASDA, policy determination, snapshots, planner, projections, Evidence and onboarding are not wired to this operation. The module and QualificationBasis v2 internals remain absent from the public entry point.

This ADR records implementation architecture under a provisional working assumption. It does not claim formal legal or MLRO approval. A later doctrinal correction is contained to this versioned LLP mapping and policy selection rather than the canonical graph, CandidateFact contract, arithmetic, company attribution or historical decision records.
