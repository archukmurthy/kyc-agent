# Controlled IDV POC protocol

## Safety rules

- Obtain tester consent and use only the vendor-hosted capture flow.
- Never upload identity media to this repository, fixtures, logs, analytics,
  tickets, email, chat, or support channels.
- Test IDs must match `TEST-[A-Z0-9-]` and contain no names or identifiers.
- The return page displays only internal session ID and status. Provider webhook
  results—not browser return—are authoritative.
- Use the scorecard only as `OUR_MEASURED_METRIC`; do not import vendor claims.

## Stage A: automated synthetic

Run `npm run idv:test` and `npm run idv:security-scan`. Fixtures cover both
provider contracts, signed webhooks, duplicates/out-of-order delivery, provider
errors, state mapping, corrections, encryption tamper/AAD, JWT authorization,
metric semantics, third-provider routing, secret scan, and raw-evidence guards.

## Stage B: provider sandbox

Configure official sandbox/test accounts and public HTTPS endpoints. Run
approved, declined, retry, failure, expiry, duplicate, and delayed webhook
scenarios without unnecessary real evidence. Record provider environment,
workflow/tier/version, test-case ID, device/document metadata, and whether each
attempt/stage timestamp is actually exposed.

## Stage C: controlled genuine-user POC

Start with approximately 5–10 consenting testers using both providers where
practical. Vary iOS/Android, passport/driving licence/national ID, legitimate
issuing countries, and ordinary camera/lighting conditions. This sample is for
integration and measurement discovery, not statistical provider selection.

For each run record only non-PII ground truth:

- `genuine_user_label` and label source;
- `valid_technical_opportunity`;
- boolean correctness flags for first name, last name, DOB, nationality,
  address, and document number;
- whether the tester experienced retry;
- test-case/cohort ID.

Never duplicate the actual name, DOB, address, or document number into ground
truth/metrics. Genuine first-time success is unavailable until the independent
label and valid-opportunity flag exist.

## Post-IDV confirmation

The internal confirmation path requests an OIDC SecurityContext and explicit
field allowlist, retrieves only those encrypted attributes, and records each
confirmation/correction/rejection append-only. The original provider extraction
is immutable. A deployment may render this controlled screen around the service
methods; it is deliberately not wired into KYC in this branch.

## Launch checklist

1. Apply IDV schema with a non-owner, non-BYPASSRLS application role.
2. Inject approved managed-key adapter and verify wrap/unwrap permissions.
3. Configure OIDC issuer/audience/claims, workload identity, subject resolver,
   and POC tester authentication.
4. Configure separate provider sandbox credentials, exact workflow/tier,
   signature secrets, callback URL, and public HTTPS webhook URL.
5. Set `IDV_RUNTIME_MODE=poc`, `IDV_POC_HARNESS_ENABLED=1`, and never enable
   synthetic storage for real people.
6. Validate signed webhook delivery before asking a tester to proceed.
7. Review scorecard availability reasons and low-sample warnings after runs.
