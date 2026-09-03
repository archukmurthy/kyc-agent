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
