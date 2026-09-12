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

Production builds stage the standalone assets at `/ubo-control-lab/`. Fixture applicant sessions use the integrity-checked `ubo-control-lab-applicant-session-cache-v1` contract at browser-local key `ubo-control-lab.applicant-sessions.v2`. Refreshing or reopening the protected preview restores the last valid fixture session, including its active Snapshot, history and completed-task state. `Resume last demo`, `Start new case` and confirmed `Reset this demo` controls govern that local state. This is a Lab demo convenience only: there is no database, server-side, multi-device or production case persistence. Fresh Live sessions are not cached without explicit opt-in. The sealed Decision Application envelope and verified immutable DecisionSnapshot history remain authoritative.

## Evidence and feedback

The Evidence panel displays references and external handoffs only. It contains no upload or Extraction implementation. Practitioner feedback is local to the browser session and can be copied or downloaded as JSON with the current snapshot hash and optional requirement, entity or work-item context.

KYB onboarding integration remains blocked by Control Room product validation in the UBO Control Lab.

## Successor review mode (Wave 10)

The top-level selector now makes the doctrine explicit: `BASELINE — 1.5-RC` retains the existing session-v1 application and customer view; `SUCCESSOR REVIEW — 1.6-RC` creates only `ubo-control-lab-session-v2` sessions through `ubo-control/review`. The successor review factory exposes `intake`, `applyDecisions` and `evaluate`; it does not expose customer input, capability execution or persistence.

Successor mode offers ten sanitized actual-engine fixtures, saved-result Replay with zero external calls, and one-shot Live Discovery with the existing cost warning. The two ASDA profiles are labelled `LAB REVIEW PROFILE — NOT PRODUCTION APPROVED`; their hash, effective/review period, entitlement context, capability entries, used entries and A-15 dependency are inspectable. Changing profile creates a linked Snapshot v2 with `PLANNING_CONTEXT_CHANGED` and preserves the predecessor.

The workspace uses one current Snapshot v2 across Case Summary, Ownership & Control Graph, Qualifications, Requirements & Causal Needs, Resolution Plan, Evidence, Decision History, Diagnostics and Baseline Comparison. Graph filters are display-only. Counts open deterministic lists.

## Wave 11A read-only applicant contracts

The successor workspace now adds an Applicant Preview and Contract Inspector generated from public `ubo-journey-projection-v2`. They expose immutable plan-pinned customer work bundles, completion distinctions, policy-content blocks and external Evidence handoff readiness without submitting actions. The preview clearly labels `EVIDENCE HANDOFF READY — EXECUTION NOT CONNECTED` and `POLICY CONTENT REQUIRED` where applicable.

This Wave 11A preview remains a separate read-only contract view. Only the Wave 11B1 Applicant Journey tab calls the fixture Lab's explicit Decision Application v3 customer-input operation; neither view invents unsigned policy wording, uploads files, runs Extraction, persists state or integrates with onboarding.

## Wave 11B1 interactive applicant journey

The successor workspace retains the Wave 11A Applicant Preview and Contract Inspector and adds `Applicant Journey v2`. Its AJV2-01 through AJV2-15 sanitized fixtures are generated through Decision Application v3, Snapshot v2, ResolutionPlan v2 and JourneyProjection v2. Test-only schema-1.3 content fixtures are labelled and never mutate the real 1.6-RC policy.

The applicant calls one Lab-host operation, `SUBMIT_APPLICANT_ACTION_AND_ADVANCE`. The host still calls Decision Application v3 `applyCustomerInput`, records its result, records the no-decisions-required checkpoint where safe, then calls `evaluate` and refreshes JourneyProjection v2. Those operations remain separate and visible in analyst diagnostics, but the applicant sees one coherent submission. Any candidate identity, claim, correction/review, external Evidence, delegation, policy-content or sign-off target stops automatic continuation and moves the response to the truthful pending state.

Applicant-facing checkpoint and re-evaluation controls have been removed. For deterministic ownership fixtures only, the Decision History view may show `DEMO FIXTURE — PRECONFIGURED REVIEW DECISIONS` and one internal continuation button. It uses the normal `applyDecisions` and `evaluate` operations and is unavailable for Live or Replay data. Submitted activity, current tasks and internal progress are presented separately.

The durable design principle is: domain operations remain explicit and auditable, while the host automatically orchestrates non-judgmental steps so the applicant performs only genuine customer actions. Lab browser-local resumability is a demo/testing convenience and is not production case persistence.

## Wave 11B2A pre-ingested Bettercomms demonstration

Choose `BETTERCOMMS EVIDENCE DEMO` in the top-level Lab selector. The fixture starts with Snapshot A and a real plan-derived `ExternalEvidenceHandoff v1`. `Use pre-ingested Bettercomms ownership chart` passes the accepted existing Artifact reference through an `EvidenceConsumerV1` constructed from `evidence/consumer/v1/index.js`, the merged UBO Evidence extraction adapter, and the existing ExtractionService seam. Trusted fixture authority is supplied only by the server composition root.

The candidate review displays six source-backed facts from one Artifact and stays explicitly non-operative. The fixture-only Compliance helper then applies exact source-occurrence identity decisions and claim decisions through Decision Application v3. Snapshot B retains Snapshot A and shows four economic graph relationships, Mitchell Fortescue's exact 75% statutory effective-interest result, Lee Taylor's exact-25% route-specific non-satisfaction, and two officer-role facts as non-control metadata.

The accepted Lab scenario explicitly establishes the four economic chart assertions as current at `2026-09-08T10:00:00.000Z`; the two officer assertions retain the Evidence fixture's `UNKNOWN` temporal state. This fixture-only currentness is what permits the fresh engine to evaluate the economic path, and it is never inferred from the Artifact capture timestamp.

Completed demo state is sealed locally under `ubo-control-lab-preingested-evidence-cache-v1` at `ubo-control-lab.preingested-evidence-sessions.v1`, then re-verified by the server on restore. The cache contains public references and immutable UBO records only—no document bytes, raw provider payload, credentials, access tokens, Blob URLs, filesystem paths, or Evidence internal objects.

Wave 11B2A proves the existing-Artifact Evidence-to-UBO decision cycle. It does not provide a production private-upload front door. Trusted private ingestion remains a separate production-readiness programme.

AJV2-13 uses the actual ASDA system-coverage plan and exposes no customer form. AJV2-14 uses the actual exhausted profile and renders exactly its three pinned bundles, including blocked residual content and external Evidence handoff only where planned. No action in this tab calls Discovery or Evidence merely by being viewed.

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
