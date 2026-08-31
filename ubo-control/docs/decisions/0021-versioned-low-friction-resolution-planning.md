# Decision 0021 — Versioned low-friction resolution planning

**Status:** Proposed for G5.2B acceptance.

## Decision

Expose `planUboResolution({ decisionSnapshot, contractVersion? })` as a separate stateless public operation returning `ubo-resolution-plan-v1`, pinned to the operational strategy `ubo-low-friction-planner-v1`.

The planner applies only after policy/orchestration has established permitted ResolutionOptions. It selects currently actionable zero-customer-friction work first, then minimizes and coalesces necessary customer work, then routes internal/specialist review. ResolutionAttempts suppress unchanged substantive retries. Operational failure remains retry/hold or blocked and cannot independently create customer burden.

## Consequences

Planning preferences remain a versioned product layer rather than UK Corporate policy semantics. The planner cannot create requirements, change applicability/sufficiency, resolve requirements, execute capabilities, mutate snapshots or prescribe UI. Discovery and interpretation of already-held evidence have no universal precedence and may share one system wave.

CustomerResolutionBundles carry semantic need/requirement/entity references, known and missing facts, targeted recorded evidence types, selected customer actions and deferred permitted alternatives. They are not forms. The host re-evaluates after a material system or customer wave and plans again from a fresh DecisionSnapshot; no mutable planner workflow state is retained.

No numeric friction score, provider cost/latency selection or customer-configurable ranking enters v1. Future operational profiles must have distinct product strategy versions and must not alter compliance reasoning.
