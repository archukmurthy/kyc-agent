# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | **Gate 1 — COMPLETE AND ACCEPTED**; Gate 2 remains unopened |
| Branch | `docs/ubo-practitioner-research-001` |
| Base commit | `d9c0a28b9558c8d6529949b83e2bb1849d94ff85` (G1.2B merge on `origin/main`) |
| Latest accepted PR | [#29 — UBO Control G1.2B deterministic scenario universe](https://github.com/archukmurthy/kyc-agent/pull/29), merged with merge commit `d9c0a28b9558c8d6529949b83e2bb1849d94ff85`; remote G1.2B branch deleted |
| Current PR | [#30 — UBO Control practitioner research hypotheses](https://github.com/archukmurthy/kyc-agent/pull/30) — documentation-only; do not merge without Control Room acceptance |
| Completed implementation | UBO Control now exists as a separately bounded product with explicit external capability contracts, canonical policy infrastructure, UK Corporate policy pack, deterministic test stubs and a reusable executable scenario universe, with no dependency on legacy/provider/onboarding implementations and no premature UBO reasoning engine. |
| Practitioner evidence | `PRACTITIONER-001` recorded as `PRACTITIONER_EVIDENCE` with `NON_POLICY` authority; architecture change `NONE`; policy change `NONE`; contract change `NONE` |
| Future-gate hypotheses | JH-001 through JH-007 recorded for future Journey/Resolution work; none is approved execution logic |
| Outstanding implementation | Gate 2 remains unopened pending a Control Room implementation specification |
| Tests / status | Documentation branch: UBO 88/88 passed; host 25 suites / 482 tests passed; architecture 2/2 passed; `git diff --check` passed. Accepted G1.2B coverage: 98.88% line / 96.14% branch. |
| Active escalations | None. Practitioner evidence cannot amend policy, architecture, capability contracts, fallback eligibility or Evidence/UBO boundaries. |
| Next approved step | Complete the documentation-only practitioner research PR, then stop; do not begin Gate 2. |

## Scope guard

Gate 1 is complete and accepted. This documentation branch records practitioner evidence and future-gate hypotheses only. It changes no architecture, policy, contract, scenario semantics, stub, domain/public code, deterministic calculation, UBO reasoning, onboarding, Evidence Platform or legacy UBO behavior. Gate 2 has not started.
