# Control Room decisions for Wave 1

## Authority and scope

- The File 09 read-only impact map is accepted.
- PR #45 and UK Corporate 1.5-RC are the immutable Lab and characterization baseline, not a production-approved release.
- Only Wave 1 is authorized: additive Policy Pack schema 1.3 support, a stateless runtime-readiness guard, and an explicit Lab review-policy watermark.
- The preserved Freeze Pack in this directory supersedes conflicting earlier design notes for successor UK MVP work. Existing ADRs remain historical records.
- The supplied package contained Files 01-09 and the accepted impact map. `00-FREEZE-PACK-MANIFEST.md` is a packaging index only and introduces no doctrine.

## Schema and sign-offs

- Schema 1.3 follows the repository camelCase convention and is additive; schemas 1.0, 1.1 and 1.2 remain unchanged.
- Approved sign-off statuses are `OPEN`, `RESEARCH_COMPLETE_SIGNOFF_PENDING`, `APPROVED`, `REJECTED`, `DEFERRED`, and `WATCH`.
- Current decisions: `A-01` and `A-18` are `DEFERRED`; `A-06`, `A-07`, `A-08`, `A-09`, and `A-12` are `RESEARCH_COMPLETE_SIGNOFF_PENDING`; `A-02`, `A-03`, `A-04`, `A-05`, `A-10`, `A-11`, `A-13`, `A-14`, `A-15`, `A-16`, and `A-17` are `OPEN`. No sign-off is `APPROVED`.
- Runtime readiness is driven by requirements declared by the pack, never by hard-coded `A-*` identifiers.

## Runtime decisions

- Runtime modes are `LAB`, `PRODUCTION`, and `HISTORICAL_RECONSTRUCTION` with explicit evaluation time.
- Lab loading never implies production readiness and review packs require a visible watermark.
- Production fails closed unless release status, effective period, approving authority, declared sign-offs, enabled-feature dependencies, schema/hash, and required algorithm versions are all ready.
- Historical reconstruction requires the exact pinned policy identity and hash, may verify genuine historical review packs, and cannot authorize a new production determination.
- Existing Decision Application v1 and v2 operations and behavior are unchanged. Readiness is a separate public operation.

## Successor direction recorded, not implemented

- Internal InformationNeed lifecycle remains `OPEN`, `SATISFIED`, and `SUPERSEDED`. OperationalBlocker, ReviewRequirement, and SpecialistRoute remain separate domain records. Any normalized v2 projection state is non-destructive presentation.
- The approved future sequence is requirements -> causal InformationNeeds -> ResolutionPlan v2 -> DecisionSnapshot v2. Snapshot v2 will pin its plan, and planner v2 will expose that pinned plan.
- Repository-level legacy “25% or more” guidance is non-authoritative for fresh successor UBO Control. The successor Policy Pack owns its comparator. Historical behavior and UK Corporate 1.5-RC are unchanged.
- No Wave 2 doctrine, policy content, attribution, layer closure, planner/snapshot v2, or integration work is implemented by Wave 1.

## A-06-WA-01 — review-only LLP attribution working assumption

- Review-only approval date: **2026-09-04**.
- Control Room authorizes a separate internal LLP/mixed COMPANY/LLP attribution implementation under working assumption `A-06-WA-01`; this is provisional implementation doctrine only, not an amendment to the Policy Pack and not legal or MLRO approval.
- A direct current LLP surplus-asset or voting right above the applicable policy threshold may satisfy its distinct LLP condition. A current explicit right to appoint/remove a majority of persons entitled to participate in management, or explicit unambiguous LLP SIoC, may satisfy its own distinct condition.
- An LLP intermediary may be traversed only through explicit strict `>50%` voting or explicit majority-management appointment/removal. Economic, surplus-asset, profit or capital rights never imply majority control. Generic SIoC, agreement wording and dominant-control wording do not become majority steps without faithful approved canonical semantics.
- Mixed COMPANY/LLP attribution retains the full target right and does not multiply upstream voting/control percentages with downstream economic rights. Distinct holders' percentages are never summed and no joint arrangement is inferred; explicit joint signals remain review-required under A-13 and produce no attribution.
- The three sanitized TDR holders retain separate `(25%,50%]` LLP voting ranges. Each may satisfy a direct voting condition if TDR itself is the target, but none has a proven `>50%` majority step for downstream ASDA attribution. The TDR/ASDA conclusion remains provisional; no final positive or negative natural-person UBO result is authorized.
- Every result is `REVIEW_ONLY`, has `productionAuthorized=false`, requires A-06, and additionally retains A-09 for company Schedule 1A semantics, A-12 for appointment/removal and A-13 for a joint signal. A-06 remains `RESEARCH_COMPLETE_SIGNOFF_PENDING`; MLRO/legal validation and production authorization remain pending.
- Production restrictions: the capability is private, is not wired into Decision Application, current Lab/ASDA, projections, planner, Evidence or onboarding, and is not publicly exported. It may not support a production determination.
- Contained rework boundary: a later A-06 correction is confined to the versioned LLP mapping and review-policy selection. CandidateFact contracts, canonical graph, effective-interest arithmetic, company attribution, Decision Application, historical snapshots, capability ports and Evidence boundary remain unchanged.
- This record agrees with the existing Compliance Decisions Register: A-06 remains unresolved and blocks production-authorized LLP attribution, automatic joint-arrangement attribution and a final deterministic TDR/ASDA conclusion.

## Wave 7 review-only successor kernel

- Wave 7 authorizes the private `ubo-phased-evaluation-v1` kernel and `ubo-decision-snapshot-v2`; it does not authorize public Decision Application v3, Lab v2, InformationNeed v2 or ResolutionPlan v2.
- Evaluation is restricted to explicit LAB mode, schema-1.3 policy identity and deterministic evaluation time. Every snapshot is `REVIEW_ONLY`, `TRANSITIONAL_REVIEW_ONLY` and `productionAuthorized=false`.
- R13 retains its existing combined ownership/control maximum-path semantic, with separate economic and voting depths recorded for audit. R02/R03/R07 use derived graph/person facts and reject caller authority.
- LLP analysis may compose beside company analysis only through explicit `SUCCESSOR_REVIEW_ONLY` mode. It retains the immutable policy identity, A-06-WA-01 and A-06; the default standalone LLP method guard remains unchanged.
- The plan-before-snapshot bridge is explicitly `ubo-resolution-plan-v1-compat`; no capability profile is provided. Wave 8 and Wave 9 own successor needs and planning.
- Decision history v2 verifies and reconstructs recorded v1/v2 snapshots without recalculation and permits only explicit-reason, linear cross-version supersession.

## Wave 9 review-only resolution planning

- Wave 8 is accepted and merged normally as `bf206d619588140e786823340b650a7f1c640108`. Its InformationNeed lifecycle remains `OPEN`, `SATISFIED`, `SUPERSEDED`; operational blockers, reviews and specialist routes remain separate.
- Wave 9 authorizes private `ubo-registry-capability-profile-v1`, `ubo-low-friction-planner-v2` and `ubo-resolution-plan-v2` implementation only. Public Decision Application v3, profile/plan export, Lab v2, applicant journey v2, Evidence execution and onboarding remain deferred.
- RegistryCapabilityProfile is planning context, not evidence. Exact scope/concept/channel/entitlement matching and explicit evaluation-time freshness may guide route selection but cannot resolve a need, prove absence or create a fact.
- Planning strategy is assigned per causal ResolutionGroup. `DISCOVERY_LED`, `CHART_ASSISTED`, `SPECIALIST` and `NOT_APPLICABLE` may coexist. Coherent evidence options may bundle needs while preserving each need and requirement identity; diagnostics and paths never become actions.
- System work precedes customer work for the same group. NO_DATA, UNSUPPORTED and final INCONCLUSIVE suppress unchanged substantive repeats; PARTIAL permits residual-only planning; UNAVAILABLE/FAILED remain operational retry/hold states and do not independently burden the customer.
- Profile, strategy, action, wave and predecessor pins are decision-significant. Equivalent material inputs cannot oscillate strategies; a material change is required and recorded before retry/pivot.
- New snapshots use `SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY`, pin the exact Phase 8 plan and profile context, and remain `LAB`, `REVIEW_ONLY`, `productionAuthorized=false`. A-15 and A-10 remain OPEN; profile-driven behavior retains A-15 and no new A-10 measure-category execution is introduced.
