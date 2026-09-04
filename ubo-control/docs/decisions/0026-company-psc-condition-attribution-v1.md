# ADR 0026: Company PSC-condition attribution as a separate statutory route

## Status

Accepted for Freeze Implementation Wave 4 architecture; legal/MLRO mapping remains unapproved under A-09.

## Decision

UBO Control implements the pure internal `ubo-psc-attribution-v1` algorithm and immutable `ubo-psc-attribution-assessment-v1` envelope for supported Schedule 1A conditions in relation to a COMPANY target. Inputs are the unchanged operative canonical graph, canonical entity profiles, exact schema-1.3 Policy Pack identity and provider-neutral operative claim/EvidenceReferences. The algorithm performs no identity resolution, claim adjudication, provider interpretation or raw-evidence access.

Company shares, voting rights, explicit majority appointment/removal rights and explicit SIoC remain distinct condition families. Company shares require `ECONOMIC_OWNERSHIP` qualified as `SHARE_OWNERSHIP`; shares never imply voting. A majority chain may use strict `>50%` voting or an explicit majority appointment/removal fact. Generic economic ownership and generic SIoC are not majority steps. Agreement-based control and dominant influence remain unsupported until the canonical vocabulary can state the required semantics faithfully.

Indirect attribution carries the controlled company's full target right to the natural person. It does not multiply upstream and downstream percentages. Each distinct target right is aggregated once, while every valid majority chain remains in the trace. Consequently an effective-interest basis and a PSC-attribution basis may coexist with different values and states; no route union or final person-level UBO result occurs in this wave.

Only natural persons receive bases; target and intermediary entities must be COMPANY. LLP, partnership, fund, trust and other specialist profiles are not traversed. Relevant uncertainty, currentness gaps and cycles remain conservative. Joint-arrangement attribution and trust/firm condition 5 are unimplemented.

All results retain `REVIEW_ONLY`, `productionAuthorized=false`, Policy Pack/hash and algorithm identity, with A-09 required. Appointment/removal adds A-12, explicit joint signals add A-13 without attribution, and LLP diagnostics add A-06. This ADR records implementation architecture only and does not approve the legal mapping.

## Consequences

`ubo-percentage-lookthrough-v1` and Wave 3 effective-interest behavior remain unchanged. The new operation is internal and absent from `index.js`. Decision Application v1/v2, policy determination v1, DecisionSnapshot v1, requirements, planner, projections, UI, Lab, ASDA fixtures, legacy Discovery, Evidence Platform and host onboarding are unchanged. Production and current Lab continue to use the existing approved boundaries; UK Corporate 1.6-RC remains review-only and production-blocked.
