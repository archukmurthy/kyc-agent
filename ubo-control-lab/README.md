# UBO Control Lab

The UBO Control Lab is a standalone, internal compliance-testing application. It consumes the public UBO Control APIs, the accepted legacy Discovery adapter and the reusable `UboJourney` and `OwnershipGraph` components. It does not integrate with the KYB onboarding application.

## Modes

- **Fixture Mode** loads one of 18 deterministic scenarios, runs Decision Application v2 and produces real immutable DecisionSnapshots and public projections.
- **Live Discovery Mode** requires a UK company name and registration number. The server invokes `/api/ubo-discovery`, translates the result through the accepted anti-corruption adapter, ignores legacy UBO conclusions and intakes only safe candidate facts.
- **Live Evidence Mode** is visible but disabled: `NOT YET AVAILABLE — EVIDENCE PLATFORM INTEGRATION IN PROGRESS`.

## Explicit decisions and customer input

Candidate parties and claims remain pending until a practitioner uses the identity and claim consoles. Decisions flow only through Decision Application v2. Customer work is rendered by the reusable `UboJourney`; its events flow through `applyCustomerInput`, produce customer-originated candidate facts, then require any applicable explicit adjudication before reevaluation. The foreign-HoldCo fixture (`LAB18`) demonstrates Snapshot A → direct shareholder response → candidate claim → explicit adjudication → linked Snapshot B.

## Run locally

Run `npm start`, then open `http://localhost:3000/ubo-control-lab/`. Live Discovery uses the same server-side environment and route configuration as `/api/ubo-discovery`; fixture mode needs no provider configuration.

Production builds stage the standalone assets at `/ubo-control-lab/`. The Lab is session-only and non-resumable: refreshing resets the active case. The sealed Decision Application envelope and immutable DecisionSnapshot history remain authoritative during the session.

## Evidence and feedback

The Evidence panel displays references and external handoffs only. It contains no upload or Extraction implementation. Practitioner feedback is local to the browser session and can be copied or downloaded as JSON with the current snapshot hash and optional requirement, entity or work-item context.

KYB onboarding integration remains blocked by Control Room product validation in the UBO Control Lab.
