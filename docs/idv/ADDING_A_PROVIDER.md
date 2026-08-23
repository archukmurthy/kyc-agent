# Adding a new IDV provider

A conventional hosted provider does not require KYC-facing changes.

1. Add one adapter implementing all methods in
   `idv/contracts/providerAdapter.js`: create hosted session, return redirect URL,
   authenticate/normalize webhook, retrieve result, capabilities, external
   evidence references, and cost information.
2. Keep provider statuses/reasons and API shapes inside that adapter. Emit the
   existing canonical session, extracted identity attributes, observations,
   provider decision, timestamps, and external-custody references.
3. Authenticate exact provider webhook bytes and reconcile ambiguous envelope
   events with an authenticated decision API read.
4. Never return raw media or hosted tokens in the canonical result. Suppress raw
   biometric scores unless a separately approved protected use requires them.
5. Register the adapter in `createIdvModule({ adapters: { PROVIDER: adapter } })`,
   include it in `IDV_ENABLED_PROVIDERS`, and add routing/cost configuration.
6. Run the same reusable provider contract cases and sanitized synthetic
   fixtures for approved/declined/retry/expired/error/out-of-order behavior.

The secure store, OIDC authorization, operational persistence, metrics,
scorecard, POC harness, and future KYC consumer contract remain unchanged.
Provider-specific optional capabilities map to canonical capability states; do
not make NFC or database checks universal assumptions.

Current canonical limitations to evaluate for unusual providers: fully embedded
SDK capture (not a conventional hosted flow), provider-required local raw-media
custody (forbidden), or a manual-review product whose lifecycle cannot map to a
single provider decision. Those require explicit product/security review rather
than adapter leakage into KYC.
