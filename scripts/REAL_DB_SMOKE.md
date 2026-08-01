# Real-database smoke test

This opt-in test exercises the actual Neon-backed API handlers with realistic
KYC journey data. It is intended to catch silent persistence and hydration
regressions while Applicant, Confirm, and Fill Gaps are extracted from
`src/App.js`.

## Safety boundary

The test refuses to run unless:

1. `TEST_DATABASE_URL` is configured;
2. it differs from `DATABASE_URL`; and
3. `REAL_DB_SMOKE_CONFIRM` has the exact acknowledgement value shown below.

Use a disposable Neon branch or separate test database with the same migrations
as the application database. Never copy the production connection string.

Create a gitignored `.env.test.local`:

```dotenv
TEST_DATABASE_URL=postgresql://user:password@host/test_database?sslmode=require
REAL_DB_SMOKE_CONFIRM=I_UNDERSTAND_TEST_DATA_WILL_BE_WRITTEN
```

Then run:

```powershell
npm run test:smoke:db
```

## What it verifies

- `api/save-dossier.js` writes a dossier containing nested, realistic research,
  directors, UBOs, coverage, questions, and document requirements.
- `api/get-dossier.js` returns that shape without losing ownership type,
  stakeholder arrays, shareholding, or the raw research payload.
- `api/change-events.js` persists a Confirm-style address correction and its
  Fill-Gaps amendment-document decision.
- `api/submit.js` persists the legacy onboarding session and the newer journey,
  declaration, completion-choice, API-usage, and field-provenance records.
- Applicant and stakeholder provenance round-trips with agent value, customer
  value, action, source, and layer.

Every run uses a unique tenant, company, submission marker, dossier, session,
and journey. In a `finally` cleanup, the script deletes only rows identified by
those returned IDs and unique markers. Cleanup failure fails the test loudly.

## What it does not verify

This is a database contract smoke test, not a browser test. It does not click
through React pages or call external research providers. Page-level component
tests and one browser journey should be added alongside page extraction, using
the same fixture shape.
