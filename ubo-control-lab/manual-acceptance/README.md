# G5.3D manual compliance acceptance evidence

Status: local production-build browser acceptance and protected deployed-preview smoke verification complete.

Date: 2026-09-01

## Paid Discovery replay test mode

This Lab build records successful normalized Live Discovery results in a bounded browser-local library. To test cost control:

1. Run `Run fresh live Discovery` once for a company whose source freshness must be tested.
2. Select `New case`, return to Live Discovery, and confirm the captured result appears under `Replay saved result` with its company number, save time, outcome, candidate-fact count and issue count.
3. Select `Replay as new UBO Lab case`. Confirm the workspace source badge and Diagnostics show `REPLAY` and a new case/snapshot is created.
4. Repeat identity decisions, claim adjudication and evaluation as required. The replay must not execute `/api/ubo-discovery`.
5. Use `Delete` to remove the saved local input.

For repeated testing of the same company, use Replay. Run fresh Discovery only when testing source freshness or a different company. Saved inputs are local testing data only; active UBO decisions and history remain non-resumable.

The checks below were performed through the staged `/ubo-control-lab/` browser application and its real Lab API. Fixture transitions were initiated through visible controls. LAB18 used the reusable customer form, `applyCustomerInput`, the explicit claim console and `evaluate`; no fixture swap or snapshot mutation was used.

| Required acceptance case | Browser evidence | Result |
|---|---|---|
| Real-company Live Discovery start | `live-discovery-revolut-nodata.png` | Revolut Ltd / 08804411 reached the real `/api/ubo-discovery` composition and returned the conservative, non-fabricated `NO_DATA` outcome with zero candidate facts. |
| Direct/multilayer resolved fixture | `lab02-compliance.png` | LAB02 rendered the multilayer graph, recorded calculation and full R01–R14 matrix under Policy Pack 1.5-RC. |
| Unresolved foreign branch | `lab18-snapshot-a.png` | Snapshot A showed Overseas Holdings SA unresolved and asked the approved structured direct-shareholder question for that entity. |
| Explicit identity decision | `lab17-decisions.png` | LAB17 exposed unresolved candidate parties in the explicit identity console; no fuzzy or automatic match was applied. |
| Explicit claim adjudication | `lab17-decisions.png`, `lab18-snapshot-b-history.png` | The claim console exposed the approved claim states. LAB18 applied `OPERATIVE` explicitly before evaluation. |
| Customer action resolving a branch | `lab18-snapshot-a.png`, `lab18-snapshot-b-history.png` | Alice Owner → 80% economic ownership → Overseas Holdings SA entered as a customer candidate relationship and then passed through explicit adjudication. |
| Before/after graph | `lab18-snapshot-a.png`, `lab18-snapshot-b-history.png` | Snapshot B added the Alice relationship and the recorded effective calculation changed from 80 to 64. |
| R01–R14 compliance view | `lab02-compliance.png` | All fourteen requirement rows, policy identity, state, calculations, needs, gaps, blockers, reviews and risk signals were visible. |
| Conflict scenario | `lab10-conflict.png` | LAB10 exposed two public graph conflicts in both the compliance summary and the textual graph. No winning claim was selected. |
| Internal fallback-review state | `lab15-fallback-review.png` | LAB15 exposed the current fallback/review state without assigning a customer-side fallback conclusion. |
| Historical snapshot selection | `lab18-snapshot-b-history.png` | Two immutable snapshots were selectable; Snapshot B linked to Snapshot A and showed semantic relationship/calculation changes. |
| LLP case | `lab13-llp.png` | LAB13 used LLP semantics and did not display the COMPANY direct-share wording. |

Additional browser checks:

- Customer and Compliance views consumed the same current snapshot.
- Resolution Planner displayed the current `ubo-resolution-plan-v1`, actor, wave, actions, bundles, alternatives and rationale.
- Feedback JSON was copied successfully with `sessionOnly: true` and the current snapshot hash.
- Diagnostics displayed Decision Application v2, graph/journey/plan versions, policy identity, graph version, calculation algorithms and snapshot contract.
- `lab18-evidence-disabled.png` confirms Live Evidence is disabled and no fake upload/extraction path is offered.
- Refresh/new-case behavior reset the session as labelled; no resumability was claimed.

## Ownership-graph blocker remediation

The sanitized `asda-regression.json` fixture reproduces the provider-result shape that exposed the product-test blocker without retaining provider payloads or real upstream company data. It passes through the real legacy adapter, explicit Lab identity/claim decisions, canonical graph, public projection and production renderer.

| Acceptance view | Browser evidence | Result |
|---|---|---|
| Corrected initial view | `asda-corrected-initial-fit.png` | The map reports 12 map entities and 32 map relationships, keeps labels readable at 100%, and anchors the customer at the bottom of the owner-to-customer hierarchy. |
| Intermediate holding chain | `asda-corrected-intermediate-chain.png` | Selecting Example Finance Plc focuses its subject-reaching route while preserving readable intermediate nodes and relationship values. |
| Upstream highlighted path | `asda-corrected-highlighted-path.png` | Selecting Alex Example highlights one clean owner-to-customer route. The visible 25% and 100% relationships remain readable and the unresolved state remains explicit. |

The useful presentation principles carried forward from the previous Discovery Lab are the obvious upstream-to-customer story, vertically legible intermediate holdings, direct percentage labels, horizontal sibling branches, and an obvious customer anchor. The legacy graph model, identity logic, UBO determination, percentage calculation and thresholds were not reused.

The initial view deliberately uses a readable-width layout inside a local scroll/zoom canvas instead of shrinking the complete hierarchy into a microscopic strip. `Fit width` restores that readable subject-anchored view; `Overview` exposes the whole graph when required. Investigation-only entities are excluded from the ownership map but remain in case state; the counters above the map are therefore labelled `Map entities` and `Map relationships`.

## Graph viewport and selection usability remediation

Date: 2026-09-02

The evidence below was captured from deployed PR #45 commit `39f1aa7` using a fresh Live Discovery result for ASDA Delivery Limited. The run used the same 12-node, 25-relationship public projection and did not alter policy, calculation, or graph semantics.

Preview: `https://kyc-agent-zayzo-40fkpnrhr-archukmurthy-3271s-projects.vercel.app/ubo-control-lab/`

| Required acceptance view | Browser evidence | Result |
|---|---|---|
| Initial Fit width | `asda-usability-fit-width.png` | The Lab gives the explainer approximately two-thirds of the desktop journey workspace and opens the long graph at a readable 65%, with vertical inspection retained. |
| ASDA Group selected | `asda-usability-group-selected.png` | All three direct incoming Bellis relationships, all three direct outgoing ASDA Stores relationships, and the complete downstream route to ASDA Delivery are highlighted and listed. |
| ASDA Stores selected | `asda-usability-stores-selected.png` | All three incoming ASDA Group relationships and all three outgoing relationships to ASDA Delivery remain distinct and highlighted. |
| ASDA Delivery selected | `asda-usability-customer-selected.png` | The panel says `Customer under review — showing relationships that reach this entity` and all 25 subject-reaching relationships are highlighted. |
| Individual relationship selected | `asda-usability-relationship-selected.png` | One economic relationship is brought to the front and isolated; its endpoints, RANGE value, currentness, source assertion, dimension and support are shown. |
| Overview | `asda-usability-overview.png` | Explicit Overview mode exposes the complete graph at 29% without replacing the default readable Fit-width inspection mode. |

## Deployed preview verification

Preview: `https://kyc-agent-zayzo-git-codex-ub-6d54dd-archukmurthy-3271s-projects.vercel.app/ubo-control-lab/`

The Vercel preview is protected by the project's existing team-login policy. The page and API were verified through Vercel's authenticated preview request path without weakening deployment protection:

- `/ubo-control-lab/` returned the staged production HTML and all Lab assets.
- `START_FIXTURE` for LAB02 returned a real 1.5-RC `DecisionSnapshot`, graph/journey projections and `ubo-resolution-plan-v1`.
- `START_LIVE` for Revolut Ltd / 08804411 executed the deployed `/api/ubo-discovery` route and returned `PARTIAL`, five candidate facts, source references and the explicit `LEGACY_KNOWN_COVERAGE_LIMITATION` issue.
- The deployed live response exposed identity and claim decision targets and did not fabricate a snapshot before those explicit decisions.

The full visual/manual checks and screenshots above were captured from the same staged production build through a local browser. Anonymous browser inspection of the branch URL redirects to Vercel login; Control Room testers require access to the Vercel team/project.
