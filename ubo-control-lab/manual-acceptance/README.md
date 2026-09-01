# G5.3D manual compliance acceptance evidence

Status: local production-build acceptance complete; deployed-preview acceptance is recorded after the branch preview is available.

Date: 2026-09-01

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
