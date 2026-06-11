# KYC Lookup Agent — Handoff Document

Owner: [assign to developer]
Last updated: 2026-06-11

## What this agent does

Calls the Nium KYB (eKYB) API in two sequential steps to retrieve verified
company data, then maps it into the same field shape the main KYC agent already
consumes from AI research. The main agent does not know the data came from Nium.

Files:

- `agents/kycLookupAgent.js` — the agent (entry point + mappers)
- `api/kyc-lookup.js` — serverless function the browser calls
- `src/setupProxy.js` — registers `/api/kyc-lookup` for local `npm start`
- `src/App.js` — fourth journey card ("Nium API Lookup"), test-mode only

## Transport / auth — reused, not re-implemented

HTTP, auth, base URLs, and credentials are delegated to **`lib/niumClient.js`**
(the verified working Nium V5 client). This agent calls its
`fetchPublicDetails()` / `fetchExhaustiveDetails()` and only adds field mapping
+ orchestration + caching. There is **no duplicated fetch logic and no
hardcoded credentials** — auth stays consistent with the rest of the app.

Auth pattern (from `lib/niumClient.js#getHeaders`):

```
accept: application/json
content-type: application/json
x-api-key: <NIUM_EKYB_API_KEY ?? NIUM_API_KEY>
X_REQUEST_ID: <uuid per call>
```

## Two API calls (sequential)

### Step 1 — publicDetails

Confirms the company exists and returns a `publicDetailsId`.

```
GET {EKYB_BASE_URL}/api/v5/client/{clientHashId}/corporate/publicDetails
```

Params: `type`, `businessRegistrationNumber`, `registeredCountry`, `region`.
Returns: `matchResponses[0].publicDetailsId` (+ `businessName`,
`businessRegistrationNumber`).

> **The eKYB registry search keys on the registration number.** A name-only
> search is not supported by this endpoint. The agent therefore returns a clear
> error when `registrationNumber` is missing (see Limitations).

### Step 2 — exhaustiveDetailsSearch

Returns the full company record including stakeholders, addresses, and registry
info. **CHARGEABLE** — the agent caches results (see Caching).

```
GET {EKYB_BASE_URL}/api/v5/client/{clientHashId}/corporate/exhaustiveDetailsSearch
```

Params: `publicDetailsId`. Returns the full company record.

## Interface contract

Input:

```js
{ companyName, countryCode, registrationNumber? }
```

Output:

```js
{
  fields: Array<{
    field: string,
    value: string,
    source: "Nium KYB API",
    sourceUrl: "https://api.nium.com",
    sourceTier: "tier1",
    verificationStatus: "verified",
    fetchedAt: ISO string,
    stakeholders?: Array,         // on "directors" / "ubo_names"
    addressComponents?: Object,   // on "registered_address"
    addressSufficient?: boolean,  // on "registered_address"
  }>,
  stakeholders: { directors: Array, ubos: Array, all: Array },
  publicDetailsId: string | null,
  raw: { publicDetails, exhaustiveDetails },
  error: string | null,
  durationMs: number,
  searchedAt: ISO string,
}
```

## Field mapping

| Nium API field                                  | KYC schema field           |
| ----------------------------------------------- | -------------------------- |
| businessName                                    | legal_name                 |
| businessRegistrationNumber                      | registration_number        |
| businessType                                    | business_type              |
| website                                         | website                    |
| registeredCountry                               | country_of_incorporation   |
| registeredDate                                  | incorporation_date         |
| addresses.registeredAddress                     | registered_address         |
| sizeOfBusiness.employeeCount                    | employee_count_band        |
| stakeholders.individual[].firstName + lastName  | directors / ubo (full_name)|
| stakeholders.individual[].dateOfBirth           | date_of_birth (pre-filled) |
| stakeholders.individual[].nationality           | nationality (pre-filled)   |
| stakeholders.individual[].sharePercentage       | share_percentage           |
| stakeholders.corporate[].businessName           | ubo_names (corporate UBO)  |
| stakeholders.corporate[].sharePercentage        | share_percentage           |

Roles: an individual whose `positions[].title` includes `UBO` is bucketed as a
UBO; otherwise a director (also matched on the word "director" in the role).
Corporate stakeholders are always treated as UBOs.

## Key advantage over AI research

Stakeholder `nationality` and `date_of_birth` are returned by the API. These
fields are normally left blank for the customer to fill. With the API they are
pre-populated as verified **tier1** data, so the customer confirms rather than
types them.

## Caching

`exhaustiveDetailsSearch` is chargeable. The agent caches its raw response via
`lib/storage.js` under key `exhaustive:{publicDetailsId}` with a 90-day TTL —
the **same key and TTL** as `api/nium/exhaustive-details.js`, so the agent and
that route share one cache and never double-charge. Cache read/write failures
are non-fatal (the agent falls through to the live API).

## Environment variables required

Same vars as the rest of the Nium integration (see `lib/niumClient.js`):

```
NIUM_EKYB_BASE_URL      # default https://api.preprod.nium.com (eKYB host)
NIUM_EKYB_CLIENT_HASH_ID# falls back to NIUM_CLIENT_HASH_ID
NIUM_EKYB_API_KEY       # falls back to NIUM_API_KEY
NIUM_CLIENT_HASH_ID     # shared gateway hash
NIUM_API_KEY            # shared gateway key
```

When these are unset (e.g. local dev without `.env.local`), `validateConfig()`
in `niumClient` throws and the agent returns `error: "Missing env: ..."` — the
serverless function responds `success:false` and the UI falls back to AI
research. Nothing crashes.

## Limitations / known gaps

- **Registration number required.** The eKYB publicDetails endpoint searches by
  registration number, so a lookup with only a company name returns
  `error: "Nium registry lookup requires a business registration number…"`.
  The fourth journey card currently sends `registrationNumber: null` (the
  company-input screen has no reg-number field yet), so the happy path needs a
  reg number wired in — see Backlog.
- **eKYB host is preprod.** Prod eKYB (`api.spend.nium.com`) needs a prod API
  key + real client hash (not yet issued); the agent stays on the verified
  preprod host via the env defaults.

## Backlog

- [ ] Collect a business registration number on the company-input screen (or a
      name→reg-number resolver) so the Nium card has a usable happy path.
- [ ] Cache results by `publicDetailsId` for `publicDetails` too (only
      `exhaustiveDetails` is cached today).
- [ ] Handle pagination on `matchResponses` (currently uses the first match).
- [ ] Add further field mappings as Nium API coverage expands.
- [ ] Add UBO threshold filtering (currently returns all UBOs).
