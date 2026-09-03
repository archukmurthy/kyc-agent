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
