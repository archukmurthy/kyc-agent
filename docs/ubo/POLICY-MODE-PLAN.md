# Policy mode - plan (UBO-34)

Status: **plan, awaiting the owner's go** (2026-10-01).

## What the partner defined (2026-10-01)

> Policy mode = which approved policy track applies to this case.

- `STATUTORY_ONLY` - UK law: a beneficial owner holds **more than 25%**.
- `STATUTORY_PLUS_FIRM_OVERLAY` - the same, plus the firm's own stricter
  collection rule (e.g. **10% or more**). Someone caught only by the overlay is
  **never** labelled a statutory beneficial owner: they get a separate
  classification.
- Later, other tracks (e.g. `EU_AMLR_2027`).

It is **not** test vs live (that is the environment), and **not** what keeps old
cases on old rules (that is the policy version and a hash pinned to the
assessment).

## Found while planning: the 25% line is drawn in the wrong place

UK law (MLR 2017 reg. 5) and the partner's own rulebook
(`ubo-control/policies/uk-corporate/*/policy.json`: `ownership_threshold_pct`,
unit `percent_exclusive`) say **more than** 25%. The demo's engine defaults to
**25% or more** (`ownershipResolutionEngine.js` - `determineUboFromMeasurement`,
`qualifies`, and the `>=` fallbacks), so a person holding exactly 25% is
labelled a beneficial owner. Step 1 fixes this on its own, with tests.

## The model

Every assessment records one **policy identity**:

| Field | Example |
| --- | --- |
| Policy ID | `UBO-UK-CORPORATE` |
| Policy version | `1.6` |
| Policy mode | `STATUTORY_ONLY` / `STATUTORY_PLUS_FIRM_OVERLAY` |
| Statutory rule | `> 25%` (fixed by law, not configurable) |
| Firm overlay | disabled, or `>= 10%` |
| Policy hash | `sha256:` of the canonical form of all of the above |

**Who chooses the mode:** the workspace's owner or admin, as a setting. Each new
case **copies** the workspace's current policy when it is created and keeps it:
changing the setting affects new cases only. That is what makes an old
assessment reproducible.

**Classification:** a person above the statutory line is a beneficial owner, as
today. With the overlay on, a person at or above the overlay line but not above
the statutory one is `FIRM_OVERLAY_SUBJECT` - shown as "collected under the
firm's policy (≥10%) - not a statutory beneficial owner".

## Steps (each its own tested commit)

1. **Fix the 25% line** (`> 25`, exclusive) through every engine path; tests at
   24.99, 25 and 25.01.
2. **Policy identity**: one module building the identity and its hash; tests
   that the same policy always hashes the same and any change hashes
   differently.
3. **Workspace setting**: mode and overlay line, owner/admin only, server-side;
   default `STATUTORY_ONLY`. The case copies it at creation (server, never from
   the request).
4. **Engine**: pass the case's policy instead of the bare number 25; add the
   overlay classification; decide identity checks for overlay people (decision
   below).
5. **Record it**: the policy identity on the trace, on the assessment version row
   (migration `030`: `policy_mode`, `policy_hash`), and in the audit ledger.
6. **Screens**: the policy block on Analyst review and Audit; the overlay label
   on people; the setting on the owner's screen.
7. **Adversarial review**, all suites.

## Decisions needed from the owner

1. **Who sets the mode** - per workspace by owner/admin (recommended), or per case
   by the analyst?
2. **Do overlay people need identity checks?** Recommended: yes, labelled
   "firm policy", since the firm collects them.
3. **Overlay line** - fixed at 10%, or set by the owner within bounds (recommended:
   any value from 1% up to, but not including, the statutory 25%)?

## Not in this work

- Other tracks (`EU_AMLR_2027`, other countries) - the model leaves room for them.
- The assessment "as-of" date and the control-discovery mode (rows 6 and 14 of
  the partner's list) - separate items.
- Reading the partner's full rulebook pack from `ubo-control/` - that module is
  reached only through `contracts/capability.js`; the version and threshold are
  taken from it by hand and recorded with their source.
