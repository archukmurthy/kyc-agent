# UBO database - proposal

> **Status, 2026-09-25.** Sections 1-7 below were written on 2026-09-22, before the
> Production Readiness Solution Guide arrived. They are narrower than the guide:
> they store the decision, where the guide stores the assertions a decision was
> made from and derives the decision as a projection. The guide is the better
> model and supersedes them. Section 0 is the one decision already taken and it
> governs whatever is written next. Four of the five open questions in section 7
> are answered by the guide.

**Status: proposal. Nothing here has been applied.** Written 22 September 2026
after a read-only diagnosis of what UBO persists today. It needs approval from
the UBO product owner before any migration runs.

The shapes below are not invented. Every table exists because something in
`ubo-control/` already emits a record of that shape, or because the demo keeps
it in a browser today and loses it on refresh. Where a column mirrors a contract
field, the contract is named.

---

## 0. The decision this schema must honour - taken 2026-09-25

**UBO gets its own tables. It refers to other modules by plain text, never by a
database link.**

The Production Readiness Solution Guide describes one shared structure - Case,
Parties, Research, Evidence, Assertions, Questions, Assessment, IDV, Audit in a
single database, with UBO holding IDV session references and one correlation id
threading through Evidence and IDV. Read literally that is a single product.

It was weighed against the standing requirement that UBO is sellable on its own,
and the owner chose separation. Concretely:

```
Evidence's own tables                 UBO's own tables
  documents                             facts
    id: 77   chart.pdf                    id: 5  "Alice owns 30%"
                                          came_from: "evidence:77"   <- text
```

`came_from` is a note, not a foreign key. Nothing in UBO's schema can be
declared against a table UBO does not own, and nothing in UBO ever follows the
reference to fetch what it points at.

**Why, in one line:** code separates by deleting a file; a database does not.
Hand a client tables full of links pointing at tables they do not have and the
database refuses to create them - that is a rewrite, not a delivery. Hand them
tables holding reference text and they work on the first day.

**The three rules that follow, and every migration is checked against them:**

1. **UBO owns every table it writes to.** Its own cases, parties, assertions,
   resolutions, assessments, questions, audit events. The same company may
   therefore exist as a row in both Evidence and UBO. That duplication is
   accepted deliberately: duplication you can see beats a join you cannot
   remove.
2. **References are text, and are never dereferenced.** UBO may record that a
   fact came from an Evidence artifact, or that a person has an IDV session. It
   may not read either. Section 18 of the guide already asks for exactly this
   for IDV - a session reference, not the passport image - so the pattern is the
   guide's own.
3. **`case_id` and `correlation_id` are given to UBO, not looked up by it.** It
   stamps them on everything it produces and hands them back. It never asks
   anyone what they mean. This is what satisfies section 21's end-to-end
   identity without UBO reaching into another module to get it.

**What this does not cost.** Everything the guide asks for still works:
assertions as the record with the graph as a projection, full lineage from
source to decision, immutable assessment snapshots, an append-only audit
ledger, one id across the whole case. None of it needs a shared table.

**What it does cost.** Some duplication, and the discipline to keep it. A person
or company known to both modules is stored twice. The guide's own canonical
Party model (section 6) lives inside UBO's schema, built from what UBO is told,
not from a table it shares.

**Still to be confirmed with the product owner:** whether she agrees, since the
guide reads the other way. The decision above is the owner's instruction for how
we build; if she wants shared tables it is a different schema and a different
product.

---

## 1. What exists today

**One table: `public.ubo_investigations`** (migration 009). Twenty-one columns,
seven of them JSON blobs - `ownership_graph`, `evidence`, `resolutions`,
`determination`, `search_events`, `investigation_log`, `missing_information`.

Three facts about it:

- **Zero rows** on the dev database.
- **Nothing ever reads it.** There is no `SELECT` against it anywhere in the
  repository. `agents/ubo/uboDatabaseAudit.js` writes; nobody consumes.
- It lives in the platform's `public` namespace rather than UBO's own.

It cannot answer "which companies list this person as a UBO" without unpacking
JSON in every row.

**Proposal: leave it alone and stop writing to it once the tables below exist.**
Dropping it is a separate decision for whoever owns the legacy discovery path.

## 2. Where these tables live

**A separate Postgres schema, `ubo`, in the same database.**

The product owner confirmed tables will be separate and that "UBO is just another
micro service I should be able to call from my main code, otherwise there is no
link". A named schema gives that separation now, costs nothing, and the day UBO
ships standalone it becomes a different connection string rather than a
migration.

**No foreign keys cross the line.** Nothing in `ubo.*` references `public.*`, and
nothing in `public.*` references `ubo.*`. If the platform needs to associate one
of its cases with a UBO case, the platform keeps that mapping on its own side -
UBO stores nothing about the platform at all.

## 3. Identity: two tables everything else points at

Clerk tells us who someone is. It does not tell us what they may see, and its
user ids are not stable across instances - moving from a development instance to
a production one gives every person a new id, and Clerk does not migrate them.

So UBO keeps its own identity, and Clerk's id is a lookup column rather than a
key:

```sql
CREATE TABLE ubo.workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ubo.users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES ubo.workspaces(id),
  clerk_user_id  TEXT UNIQUE,          -- lookup, not identity: changes if Clerk moves
  email          TEXT NOT NULL,        -- the stable identity; lives HERE and nowhere else
  role           TEXT NOT NULL,        -- owner | admin | analyst
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why the email is here and not on every row:** a domain move becomes one update
per person instead of thousands of rows, and one address cannot drift out of step
with another copy of itself.

**Every other table carries `workspace_id` and `created_by`**, both referencing
these. That is what makes "one company never sees another's work" a property of
the schema rather than a habit of the code.

## 4. The tables

### ubo.cases

The thing a person is working on. Everything else hangs off it.

```sql
CREATE TABLE ubo.cases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES ubo.workspaces(id),
  created_by         UUID NOT NULL REFERENCES ubo.users(id),
  company_name       TEXT NOT NULL,
  registration_number TEXT,
  jurisdiction       TEXT,
  ownership_type     TEXT,
  status             TEXT NOT NULL DEFAULT 'open',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ubo.cases (workspace_id, updated_at DESC);
```

**Why:** `src/uboDemo/demoSession.js` keeps exactly this in `ubo-demo.case.v1`
and loses it on refresh. `ubo-control` identifies a case by `caseId` plus
`revisionId` (`domain/decisionSnapshot.js:457`), so the engine already assumes a
case has a durable identity.

### ubo.decision_snapshots

The sealed record of a decision. **This is the audit trail**, and the engine
already produces it whole.

```sql
CREATE TABLE ubo.decision_snapshots (
  snapshot_id            TEXT PRIMARY KEY,   -- = decisionContentHash, "sha256:<hex>"
  workspace_id           UUID NOT NULL REFERENCES ubo.workspaces(id),
  case_id                UUID NOT NULL REFERENCES ubo.cases(id),
  revision_id            TEXT NOT NULL,
  revision               INTEGER NOT NULL,
  previous_snapshot_id   TEXT REFERENCES ubo.decision_snapshots(snapshot_id),
  supersession_reason    TEXT,
  checkpoint_type        TEXT NOT NULL,      -- CASE_OPEN | SESSION_START | SUBMIT_GATE | CASE_EVENT
  schema_version         TEXT NOT NULL,
  evaluated_at           TIMESTAMPTZ NOT NULL,
  snapshot               JSONB NOT NULL,     -- the whole sealed record, stored as-is
  created_by             UUID REFERENCES ubo.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON ubo.decision_snapshots (case_id, created_at DESC);
```

**Why a JSON column here and nowhere else:** the snapshot is immutable,
deep-frozen, and **its id is the hash of its own contents**
(`domain/decisionSnapshot.js:481-487`). Splitting it into columns would let it be
edited field by field, which destroys the property that makes it evidence. The
columns above are extracted only for querying; the record of truth is the blob,
and it can be re-verified by recomputing its hash.

The self-reference gives the history chain the architecture describes: each
snapshot points at its predecessor with a supersession reason
(`ARCHITECTURE.md:243`).

**Projections get no table.** `projectOwnershipGraph` and `projectUboJourney` are
pure functions of a stored snapshot, by design. Storing their output would create
a second copy that can disagree with the first.

**Note:** the product owner asked that audit not be actioned yet. This table is
included so the shape is agreed, not to be built ahead of her.

### ubo.artifacts and ubo.extractions

An uploaded ownership chart, and what was read out of it.

```sql
CREATE TABLE ubo.artifacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES ubo.workspaces(id),
  case_id        UUID REFERENCES ubo.cases(id),
  created_by     UUID NOT NULL REFERENCES ubo.users(id),
  filename       TEXT NOT NULL,
  media_type     TEXT NOT NULL,          -- application/pdf | image/png | image/jpeg
  byte_size      INTEGER NOT NULL,
  sha256         TEXT NOT NULL,          -- proves the bytes never changed
  storage_key    TEXT NOT NULL,          -- where the bytes live; the bytes are NOT here
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sha256)          -- the same chart twice is one artifact
);

CREATE TABLE ubo.extractions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES ubo.workspaces(id),
  artifact_id    UUID NOT NULL REFERENCES ubo.artifacts(id),
  case_id        UUID REFERENCES ubo.cases(id),
  created_by     UUID NOT NULL REFERENCES ubo.users(id),
  status         TEXT NOT NULL,
  source_graph   JSONB,                  -- the ownership graph as read from the document
  issues         JSONB NOT NULL DEFAULT '[]',
  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why:** the diagnosis put "uploaded chart and its extraction" at the top of the
list of things most painful to lose - it is the expensive, manual step. Today it
lives in `ubo-demo.customer-ownership-chart.v1` and its library key, capped at
twelve records in one browser.

**Why the hash matters:** it makes "this is the document that was reviewed"
provable, and it closes the gap where nothing currently records who owns an
uploaded file.

**Bytes stay in object storage.** The browser stores already refuse to hold raw
bytes (`assertReplaySafe` blocks `contentBase64`, `fileBytes`, `blobUrl`), and
the database should keep that discipline.

### ubo.research_runs

One discovery run and what it found.

```sql
CREATE TABLE ubo.research_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES ubo.workspaces(id),
  case_id          UUID NOT NULL REFERENCES ubo.cases(id),
  created_by       UUID NOT NULL REFERENCES ubo.users(id),
  status           TEXT NOT NULL,
  subject          JSONB NOT NULL,         -- what was searched for
  candidate_facts  JSONB NOT NULL DEFAULT '[]',
  evidence_refs    JSONB NOT NULL DEFAULT '[]',
  issues           JSONB NOT NULL DEFAULT '[]',
  cost_units       INTEGER NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX ON ubo.research_runs (case_id, started_at DESC);
```

**Why these exact columns:** they mirror what a capability port returns -
`contractVersion, requestId, outcome, candidateFacts, operationEvidenceReferences,
issues` (`ARCHITECTURE.md:105`). `cost_units` exists because the engine already
limits runs by "call, concurrency, elapsed-time and cost-unit limits", and
because a trial budget needs something to count.

**Evidence references are provider-neutral** - `system`, `namespace`,
`referenceType`, `referenceId`, optional `locator` and `integrity`
(`contracts/evidenceReference.js:14-29`). They point at evidence; they never
contain it.

### ubo.jobs

UBO's own queue. Research and extraction survive a refresh, a restart, and a
failure.

```sql
CREATE TABLE ubo.jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES ubo.workspaces(id),
  case_id        UUID REFERENCES ubo.cases(id),
  created_by     UUID REFERENCES ubo.users(id),
  kind           TEXT NOT NULL,          -- research | extraction
  status         TEXT NOT NULL DEFAULT 'pending',
  request_id     TEXT UNIQUE,            -- the engine's stable operation id
  payload        JSONB NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  result_id      UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX ON ubo.jobs (status, created_at) WHERE status IN ('pending','failed');
```

**Separate from the platform's `submission_inbox` on purpose.** The retry
*mechanism* is shared plumbing; the *table* is not, because a customer who buys
only UBO must not receive the platform's onboarding queue.

**`request_id UNIQUE` is what makes a retry safe.** The engine already promises
that "stable operation/request identities make retries idempotent at the public
product boundaries" - this column is where that promise is enforced.

## 5. Retention

The product owner's instruction: nothing is deleted for seven years, hard-coded
with a comment, configurable later.

Implemented as: **no hard deletes anywhere.** Rows carry `deleted_at` when
something is withdrawn and stay put. A single constant holds the period:

```js
// Seven years. Fixed by decision on 2026-09-22 rather than made configurable,
// because a retention period that varies per deployment is a compliance
// question, not a setting. Tracked as UBO-RET-1 to make it configurable.
const RETENTION_YEARS = 7;
```

## 6. What this proposal does NOT do

- **No `external_ref` on any table.** The product owner was explicit: "otherwise
  there is no link, focus on standalone for now."
- **No projection tables.** Derived from snapshots on demand.
- **No table for the identity-match cache.** It is a speed-up, not a record.
- **No changes to `public.ubo_investigations`.** Left where it is.
- **Nothing applied.** These are files waiting for approval.

## 7. Open questions for the product owner

1. **Does `ubo.cases` match your notion of a case**, or does your flow have a
   parent above it (an engagement, a customer) that these should hang from?
2. **`revision_id` and `revision` on snapshots** - is a revision a property of
   the case that should be its own table, or metadata on the snapshot as here?
3. **Are extractions always tied to one artifact**, or can one extraction span
   several uploaded documents?
4. **Does a research run belong to exactly one case**, or can one run inform
   several?
5. **Anything in your flow design that has no home above** - the gap will be in
   the questions and analyst review modules, which are not modelled here because
   they are still being designed.
