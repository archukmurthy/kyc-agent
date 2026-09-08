# Phase 4 — Comparison hygiene (Spec)

**Goal:** Turn the raw verified identity (Didit document) and the frozen Companies House officer snapshot into a **clean, structured comparison** that band assignment (Phase 5) consumes — applying the doc's hygiene rules first so false alarms never reach band logic. **Pure functions only** — no DB, no external calls, fully unit-tested. Behind the flag; wired to nothing live yet.

## Why (doc Step 3)
These rules run before any band is assigned:
- **DOB: month/year only.** CH gives month + year for officers. Compare only month + year; never invent or compare a day. "May 1985" vs "24 May 1985" is **consistent**.
- **MRZ-first name comparison.** The passport MRZ is checksummed and more reliable than visually-extracted text. If the MRZ agrees with CH but the visual text does not → **extraction error**: correct it (`extraction_error_corrected`, treated as Band A).
- **Ignore address, nationality, gender** — they never feed the comparison.
- **Normalize presentation away silently:** case, diacritics, punctuation, name-order conventions, and a middle name present in one source but absent in the other are presentation differences. Different spellings, missing surname components, or different surnames are **substantive**.

## In scope (module: `api/idv-match/matching/`)

### 1. `normalize.js`
- `normalizeToken(str)` → lowercased, diacritics stripped, punctuation removed, whitespace collapsed.
- `parseOfficerName(chName)` → `{ surname, forenames[] }` from CH's "SURNAME, Forename Middle" format.
- `buildDocName({ firstName, lastName })` and `buildMrzName(mrz)` → the same `{ surname, forenames[] }` shape, normalized.
- Comparison of two structured names ignores name order and treats a middle name present in only one source as non-substantive (compare surname + first forename; extra forenames are not a substantive difference).

### 2. `compareDob.js`
- `compareDob(chMonthYear, documentDobIso)` → `{ consistent, conflict, missing }`.
- Extracts **month + year only** from the document DOB (full ISO date → `YYYY-MM`); compares to the CH `YYYY-MM` (or `YYYY`). If either side lacks month/year → `missing` (not a match, not a conflict). A day is never read or compared.

### 3. `compareName.js`
- `compareNames({ chName, docName, mrzName })` → `{ exactMatch, extractionErrorCorrected, comparable, missing }`.
- MRZ-first: when an MRZ name is present it is the primary document name. `exactMatch` = normalized (surname + first forename) equal between CH and the primary document name.
- `extractionErrorCorrected` = MRZ present **and** MRZ matches CH **and** the visual name does not.
- `comparable` = the document name (MRZ if present, else visual) to feed the Phase 6 equivalence engine when not an exact match.
- `missing` = CH or document name unreadable/absent.

### 4. `hygiene.js`
- `runHygiene({ officerSnapshot, verificationResult })` → the combined comparison:
  ```
  {
    name: { exactMatch, extractionErrorCorrected, comparable, missing },
    dob:  { consistent, conflict, missing },
    notMatchable,          // true if a required field (name/DOB) is missing/unreadable
    ignoredFields: ["address", "nationality", "gender"]
  }
  ```
- Reads CH name + `birthMonthYear` from the officer snapshot; the document first/last name, DOB, and MRZ from `verificationResult` (`mappedFields` + `extras.mrz`). Explicitly does **not** read address/nationality/gender for matching.

## Out of scope (later phases)
- **Band assignment** (Phase 5 consumes this output).
- **Name-similarity scoring / transliteration / phonetic** (Phase 6 engine) — Phase 4 only decides normalized-exact-match + extraction-error + supplies the `comparable` name.
- No DB writes, no UI, no journey wiring.

## Security / correctness
- Pure, deterministic, side-effect-free — trivially testable and auditable (the doc requires decisions be reconstructable).
- No PII leaves these functions; they operate on already-extracted server-side data.
- The "missing/unreadable ≠ match" rule is enforced here (`notMatchable`) so Phase 5 can route to retry rather than a false Band A.

## Testing (doc Step 9 scenarios that live here)
- Exact match → `exactMatch true`, `dob.consistent true`.
- Case / diacritics / punctuation / **middle-name-in-one-source** → normalized → `exactMatch true`.
- CH "1985-05" vs document "1985-05-24" → `dob.consistent true` (no conflict on the day).
- **Never fabricate a day** — assert a default-day comparison cannot occur (day is never read).
- MRZ agrees with CH, visual differs → `extractionErrorCorrected true`, `exactMatch true`.
- Different surname / different spelling / missing surname component → `exactMatch false` (substantive).
- Month or year differs → `dob.conflict true`.
- Missing DOB or name → `notMatchable true` (`dob.missing` / `name.missing`).
- Address / nationality / gender differences → no effect on the result.

## Definition of done
`normalize.js`, `compareDob.js`, `compareName.js`, `hygiene.js` written and unit-tested against the scenarios above; pure (no DB/network); flag OFF changes nothing; committed + pushed; tracker ticked.
