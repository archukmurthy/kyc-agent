# UBO Control Lab

The UBO Control Lab is a standalone, internal compliance-testing application. It consumes the public UBO Control APIs, the accepted legacy Discovery adapter and the reusable `UboJourney` and `OwnershipGraph` components. It does not integrate with the KYB onboarding application.

## Review-policy status

The Lab assesses its pinned UK Corporate 1.5-RC Policy Pack through public `ubo-policy-readiness-v1` in `LAB` mode at the session's explicit evaluation time. Because the pack is `CONTROL_ROOM_REVIEW`, has a null effective date, and has no approving authority, it returns `REVIEW_ONLY` and the interface persistently displays `REVIEW POLICY — NOT APPROVED FOR PRODUCTION` with the exact policy identity and current blocker/sign-off counts.

This warning is readiness metadata only. It does not alter Decision Application v2, calculations, requirements, OwnershipGraph, UboJourney, ResolutionPlan, customer actions, or Discovery replay. Lab mode never implies production approval.

## Modes

- **Fixture Mode** loads one of 18 deterministic scenarios, runs Decision Application v2 and produces real immutable DecisionSnapshots and public projections.
- **Live Discovery Mode — LIVE** requires a UK company name and registration number. `Run fresh live Discovery` invokes `/api/ubo-discovery`, translates the result through the accepted anti-corruption adapter, ignores legacy UBO conclusions and intakes only safe candidate facts. This external operation may incur provider cost.
- **Discovery Replay — REPLAY** starts a new Lab case from a saved provider-neutral `DiscoveryService` result. It never invokes the live transport and does not replay a UBO conclusion, graph, qualification or DecisionSnapshot.
- **Live Evidence Mode** is visible but disabled: `NOT YET AVAILABLE — EVIDENCE PLATFORM INTEGRATION IN PROGRESS`.

## Lab test cost control / replay

After a successful replayable Live Discovery outcome, the Lab automatically stores a bounded library of up to six normalized results in browser `localStorage`. Each entry shows the captured company and registration number, jurisdiction, save time, outcome, candidate-fact count and adapter-issue count. The library supports `Replay as new UBO Lab case` and `Delete`, survives a page refresh in the same browser, and is labelled `Saved locally in this browser — Lab testing only`.

Only the post-adapter `ubo-control-lab-discovery-replay-v1.discoveryResult` is replayed: contract/request identity, outcome, candidate facts, operation evidence references and adapter issues. Original fact/evidence metadata is preserved. Replay time and the local replay identifier are recorded separately in Lab diagnostics. Active decisions, history, calculations, graph, planner output and snapshots are never stored as replay authority.

> For repeated testing of the same company, use Replay. Run fresh Discovery only when testing source freshness or a different company.

## Explicit decisions and customer input

Candidate parties and claims remain pending until a practitioner uses the identity and claim consoles. Decisions flow only through Decision Application v2. Customer work is rendered by the reusable `UboJourney`; its events flow through `applyCustomerInput`, produce customer-originated candidate facts, then require any applicable explicit adjudication before reevaluation. The foreign-HoldCo fixture (`LAB18`) demonstrates Snapshot A → direct shareholder response → candidate claim → explicit adjudication → linked Snapshot B.

## Run locally

Run `npm start`, then open `http://localhost:3000/ubo-control-lab/`. Live Discovery uses the same server-side environment and route configuration as `/api/ubo-discovery`; fixture mode needs no provider configuration.

Production builds stage the standalone assets at `/ubo-control-lab/`. The active Lab case remains session-only and non-resumable: refreshing resets decisions and history. Only saved Discovery replay inputs persist locally in the same browser; there is no database or server-side replay persistence. The sealed Decision Application envelope and immutable DecisionSnapshot history remain authoritative during an active session.

## Evidence and feedback

The Evidence panel displays references and external handoffs only. It contains no upload or Extraction implementation. Practitioner feedback is local to the browser session and can be copied or downloaded as JSON with the current snapshot hash and optional requirement, entity or work-item context.

KYB onboarding integration remains blocked by Control Room product validation in the UBO Control Lab.

## Successor review mode (Wave 10)

The top-level selector now makes the doctrine explicit: `BASELINE — 1.5-RC` retains the existing session-v1 application and customer view; `SUCCESSOR REVIEW — 1.6-RC` creates only `ubo-control-lab-session-v2` sessions through `ubo-control/review`. The successor review factory exposes `intake`, `applyDecisions` and `evaluate`; it does not expose customer input, capability execution or persistence.

Successor mode offers ten sanitized actual-engine fixtures, saved-result Replay with zero external calls, and one-shot Live Discovery with the existing cost warning. The two ASDA profiles are labelled `LAB REVIEW PROFILE — NOT PRODUCTION APPROVED`; their hash, effective/review period, entitlement context, capability entries, used entries and A-15 dependency are inspectable. Changing profile creates a linked Snapshot v2 with `PLANNING_CONTEXT_CHANGED` and preserves the predecessor.

The workspace uses one current Snapshot v2 across Case Summary, Ownership & Control Graph, Qualifications, Requirements & Causal Needs, Resolution Plan, Evidence, Decision History, Diagnostics and Baseline Comparison. Graph filters are display-only. Counts open deterministic lists. Resolution actions and customer actions are inspection-only; the applicant panel says `APPLICANT JOURNEY v2 NOT YET ENABLED`, and Evidence says `EVIDENCE EXECUTION NOT YET CONNECTED`.

## Wave 10 deployed manual acceptance

Control Room preview: [PR #55 protected deployment](https://kyc-agent-zayzo-git-codex-ub-2203dd-archukmurthy-3271s-projects.vercel.app/ubo-control-lab/). The PR remains open and the preview is review-only.

The 2026-09-06 deployed-browser pass recorded:

| Acceptance item | Deployed observation |
|---|---|
| ASDA baseline 1.5-RC | Baseline comparison reconstructs immutable Snapshot v1 from the same normalized candidate facts, with no second search. |
| ASDA successor A | 10 open causal needs, 10 causal groups, 7 current system actions, 2 review requirements and `SYSTEM_RESOLUTION`. |
| ASDA successor B | Profile change preserves 10 open causal needs, exposes 3 current customer actions and changes the plan to `CUSTOMER_RESOLUTION`. |
| Ownership default graph | One subject-centred graph; four economic relationships visible and voting/control overlays explicitly reported as hidden. |
| Voting overlay | Nine voting relationships remain distinct; the three TDR natural persons each show the preserved `(25%,50%]` voting range. |
| Control overlay | Significant-influence/control and board-appointment relationships remain separate, readable relationships. |
| Causal need and affected paths | The open-needs count opens a deterministic ten-item list; the TDR governance need exposes three calculations, three paths, three relationships and three affected people. |
| Qualification routes | Effective-interest, PSC-condition-attribution and unassessed management-control routes are displayed separately with reasoning and sign-offs. |
| 60/40 distinction | V2-LAB-02 records 24% effective interest as not satisfied while the distinct 40% attributed target right satisfies the PSC-condition route. |
| TDR provisional state | V2-LAB-06 preserves direct LLP voting rights `(25%,50%]`, the A-06 review requirement and `productionAuthorized=false`. |
| Layer-closure endpoint | V2-LAB-04 records exact 25% and correctly reports both `>25%` routes as not satisfied. |
| Percentage-band corroboration | V2-LAB-05 records an exact 80% declaration inside the independent `[75%,100%]` registry band as `INDEPENDENT_BAND_CORROBORATED`, while retaining A-03 review governance. |
| Profile-change history | Two immutable Snapshot v2 records are linked by predecessor identity and `PLANNING_CONTEXT_CHANGED`; the second pins the ASDA B profile and plan. |
| Baseline comparison | The UI labels policy, snapshot and graph-algorithm versions, explains that v1 unresolved rows and v2 causal needs are different metrics, and states `SAME NORMALIZED CANDIDATE FACTS · NO SECOND SEARCH`. |
| Evidence state | The Evidence view says `EVIDENCE EXECUTION NOT YET CONNECTED` and provides references/assessments without upload, extraction or execution controls. |
| Review-policy watermark | `REVIEW POLICY — NOT APPROVED FOR PRODUCTION` remains visible throughout successor review inspection. |

This evidence does not authorize production use and does not introduce Wave 11 customer actions, Evidence execution, persistence or onboarding integration.
