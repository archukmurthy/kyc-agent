# G5.1B manual acceptance

Captured from the standalone demo at `http://127.0.0.1:4175/` on 2026-08-31 using the committed UI01–UI12 projection fixtures.

| Check | Evidence | Result |
|---|---|---|
| Multilayer owner → intermediary → customer hierarchy | `UI02-multilayer.jpg` | Pass |
| Recorded `80% × 50% = 40%` explanation and selected-path emphasis | `UI02-calculation-highlight.jpg` | Pass |
| Economic and voting relationships are simultaneously visible and visually distinct | `UI05-economic-voting.jpg` | Pass |
| Partial economic/voting/control facts, unknown currentness and unresolved foreign branch remain explicit without a qualifying person | `UI07-unresolved-foreign-branch.jpg` | Pass |
| Projection swap retains the same subject and shows unresolved pre-evidence structure | `UI12-before-evidence.jpg` | Pass |
| Projection swap adds Alice and the resolved path without renderer recomputation | `UI12-after-evidence.jpg` | Pass |

Keyboard selection, detail-panel focus, node/relationship ARIA names, text graph description, zoom, fit and projection-state switching were also exercised in-browser. The visual pass identified and fixed overlapping parallel relationship paths/labels; an automated regression assertion now protects that geometry.

## G5.3A adaptive customer journey acceptance

Captured from the standalone demo on 2026-09-01 using the committed CUI01–CUI17 public-contract fixtures.

| Check | Evidence | Result |
|---|---|---|
| Fully resolved data-rich company shows Alice and no customer form | `CUI01-resolved-company.png` | Pass |
| Foreign HoldCo shows graph context, highlighted canonical entity and one targeted task at desktop width | `CUI03-foreign-holdco-desktop.png` | Pass |
| Foreign HoldCo graph/task stack cleanly at the default narrow review width | `CUI03-foreign-holdco.png` | Pass |
| Only DOB and country of residence are requested for the already-known person | `CUI04-missing-identity.png` | Pass |
| 390px viewport has associated required labels, usable full-width fields, stacked graph/task and no horizontal overflow | `CUI04-mobile.png` | Pass |
| System-resolution wave contains no customer form | `CUI10-system-resolution.png` | Pass |
| Internal-review state says the customer portion is complete and contains no form | `CUI12-internal-review.png` | Pass |
| LLP request uses member and surplus-asset terminology | `CUI15-llp-journey.png` | Pass |
| Unresolved branch before simulated host action has one targeted task | `CUI17-before-resolution.png` | Pass |
| Fresh after-state projection removes the task, adds Alice and focuses the refreshed journey heading | `CUI17-after-resolution.png` | Pass |

The browser pass also exercised native keyboard form controls, required-field error messaging, canonical graph selection → bundle focus, evidence handoff without a file input, and CUI17 form submission. Submission emitted a host-neutral event; only the demo's explicit replacement with the prepared after-state removed the task.
