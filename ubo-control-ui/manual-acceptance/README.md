# G5.1B manual acceptance

Captured from the standalone demo at `http://127.0.0.1:4175/` on 2026-08-31 using the committed UI01–UI12 projection fixtures.

| Check | Evidence | Result |
|---|---|---|
| Multilayer owner → intermediary → customer hierarchy | `UI02-multilayer.jpg` | Pass |
| Recorded `80% × 50% = 40%` explanation and selected-path emphasis | `UI02-calculation-highlight.jpg` | Pass |
| Economic and voting relationships are simultaneously visible and visually distinct | `UI05-economic-voting.jpg` | Pass |
| Unknown percentage and unresolved foreign branch remain explicit | `UI07-unresolved-foreign-branch.jpg` | Pass |
| Projection swap retains the same subject and shows unresolved pre-evidence structure | `UI12-before-evidence.jpg` | Pass |
| Projection swap adds Alice and the resolved path without renderer recomputation | `UI12-after-evidence.jpg` | Pass |

Keyboard selection, detail-panel focus, node/relationship ARIA names, text graph description, zoom, fit and projection-state switching were also exercised in-browser. The visual pass identified and fixed overlapping parallel relationship paths/labels; an automated regression assertion now protects that geometry.
