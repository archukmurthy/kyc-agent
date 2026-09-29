# UBO calculations move to the server (UBO-13)

Owner decision, 2026-09-28: the server decides; the browser displays.

**What goes wrong if this is built badly:** the ownership result, the
questions a customer must answer and the list of people who need identity
checks are compliance output. Today the browser computes them and the server
stores whatever arrives (`ubo-control-lab/server/pocCaseState.js#projectCommand`),
so anyone with a browser console can mark a person verified, drop a question,
or change who is a beneficial owner - and the audit trail will say it happened.

## Where things stand

- The engines are pure and browser-free, ~2,250 lines of ESM under
  `src/uboDemo/customer/`: `ownershipResolutionEngine.js`,
  `controlDiscoveryEngine.js`, `investigationTopics.js`,
  `verificationAssessment.js`, `chartComparison.js`,
  `crossSourcePartyResolution.js`, `idvSubjects.js`. Only `new Date()`
  defaults are impure; callers pass `now`.
- Glue lives in components: `resolutionTrace` and
  `customerRecalculationPending` (`OwnershipResolutionQuestions.jsx`),
  `chartSourceCoverage` (`customerOwnershipChartSession.js`),
  `allCandidateFacts` (`demoResearch.js`).
- The server already holds the inputs: research result and chart projection
  (`ubo_poc_cases.current_projection`), chart extraction
  (`evidence_customer_extraction_jobs.result`), answers
  (`ubo_poc_question_answers`), evidence artifact ids.

## Steps (one commit each, every commit green)

1. **Shared engines.** Convert the engine graph to CommonJS in place, the
   `src/pipeline.js` precedent: CRA imports it, Node requires it. No
   behaviour change; a Node test requires every engine.
2. **Shared glue.** Move the component-held glue into a CommonJS module next
   to the engines, used by the screens and the server alike.
3. **Server recomputes.** `SUBMIT_ANSWER` carries `{ questionId, value }`;
   `SYNC_RESOLUTION` and `FINALIZE_ASSESSMENT` carry nothing computed. The
   server loads the case, runs the engines, stores its own resolution, trace
   and assessment. A browser-sent `resolution`, `assessment` or `trace` is
   ignored.
4. **Evidence outcome on the server.** Accepted or rejected is decided from
   the extraction job the server ran, by artifact id.
5. **Identity verification.** `COMPLETE_IDV` carries `{ personId }`. The
   server refuses unless `UBO_POC_IDV_MODE` is `DEMO` and the person is in the
   stored verification population, applies `completeIdentityVerification`
   itself, and records `DEMO - not verified`.
6. **Actor from the caller.** `actorType` is derived on the server, not
   read from the body. (Until the signed customer link exists, a signed-in
   tester is recorded as the analyst on analyst routes and as the customer on
   customer operations, by operation, not by claim.)
7. **Screens show the server's answer.** After each post the screen replaces
   its state with the returned projection; a local preview is allowed while
   waiting.

Tests for each step: the server ignores a forged resolution/trace/assessment;
a forged IDV completion is refused; a person outside the population cannot be
verified; recomputation from stored inputs equals the engine's output for the
same inputs.
