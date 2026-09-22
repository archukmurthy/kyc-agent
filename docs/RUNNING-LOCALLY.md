# Running this locally

Everything needed to get the product running on your own machine, in order.
Written for somebody who has never run it before.

If something here is wrong, fix it in the same change that made it wrong — a
setup guide that lies costs more than no guide at all.

## 1. What you need installed

- **Node 24** and **npm 11**. Nothing enforces this in the project, so if
  something behaves oddly, check your version first (`node -v`).
- No database is required to start. Several features need one; see step 5.

## 2. Get it running

```
npm install
npm start
```

That serves the app **and** the API together on `http://localhost:3000` — there
is no separate backend to start. (`src/setupProxy.js` mounts every API route by
hand for local use. A new route added to `api/` must be added there too, or it
works when deployed and 404s on your machine. A test enforces this.)

At this point every screen renders. What needs keys is below.

## 3. Settings — `.env.local`

Create `.env.local` in the repo root. It is gitignored and never committed.
**Changes need a dev-server restart** — the values are read at startup.

### Invent these yourself. Any value works.

```
ADMIN_PASSWORD=whatever-you-like
SUPER_ADMIN_PASSWORD=something-else
PREBOARDING_PASSWORD=a-third-thing
DOSSIER_TOKEN_SECRET=any-long-random-string
```

`DOSSIER_TOKEN_SECRET` signs the links customers receive. Locally it only needs
to be consistent with itself, so a random string is fine — but use a different
one from any other environment, or links you generate here would be valid there.

### Real keys, for the features that need them

| Setting | Needed for | Note |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | all research, document reading, policy generation | **Costs money per call.** Everything below is free. |
| `DATABASE_URL` | saving dossiers, submissions, the durable pipeline | A Neon Postgres connection string. See step 5. |
| `COMPANIES_HOUSE_API_KEY` | UK company lookups | Free. Register at the Companies House developer site. |

### Optional, and the product runs without them

- **Clerk** (`REACT_APP_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) — the login
  in front of the UBO screens. Leave both unset and the login is **off**: every
  screen works and nobody is refused. Setting the secret key is what switches
  the gate on, on the server and in the browser together.
- **Storage** (`KV_REST_API_*`) — not needed locally. Without it, everything
  that would go to Redis is written to plain files on disk instead.
- **Identity verification** (`DIDIT_*`, `COMPLYCUBE_*`, `IDV_*`) — a separate
  module, not part of the onboarding flow.
- **Spend ceilings** (`SPEND_CAP_DAILY`, `SPEND_CAP_PLATFORM_DAILY`) — they have
  sensible defaults (100 per account per day, 500 across everything). Set them
  only to raise them.

## 4. The screens, and how to reach them

There is no navigation between these. Each is its own URL.

| Surface | URL |
| --- | --- |
| Customer onboarding | `/?tenant=<id>` |
| Admin, for one customer | `/admin?tenant=<id>` |
| Pre-boarding (analyst) | `/preboarding?tenant=<id>` |
| Super-admin (all customers) | `/super-admin` |
| UBO ownership review demo | `/ubo-demo` |
| Trial invitations | `/ubo-trials` |
| People and roles | `/ubo-people` |
| Policy simulator | `/policy-simulator` |

**First run:** go to `/admin` and sign in with your `ADMIN_PASSWORD`. The
platform's own workspace creates itself on that first successful sign-in, seeded
with the default settings template. Any further customers are created from
`/super-admin`.

## 5. A database, if you want the saving parts

Without `DATABASE_URL` the screens all work, but nothing persists between
sessions and the submission pipeline has nowhere to write.

1. Create a Neon Postgres database (free tier is enough). If you are sharing one
   with somebody else, **take your own branch** rather than working in theirs —
   Neon branching is instant and means neither of you can damage the other's
   data.
2. Put the connection string in `.env.local` as `DATABASE_URL`.
3. Apply the schema:

```
node db/migrate-all.js
```

That applies every migration in order and records what it applied, so running it
again is safe and does nothing. `node db/migrate-all.js --dry` shows what it
would do without doing it.

## 6. Running the tests

```
npm test             # the screens (Jest)
npm run test:node    # the server and libraries (node --test)
npm run build        # a production build, which the tests gate
```

Both suites and a clean build run before every pull request.

If the screen tests fail with timeouts on a busy machine, try
`npm test -- --maxWorkers=50%`. Two heavy suites are slow enough to hit Jest's
default timeout when workers compete for CPU; they pass in seconds alone. That
is a known issue, tracked as TEST-2 in `docs/BACKLOG.md`.

## 7. Where the documentation is

| File | What it is |
| --- | --- |
| `CLAUDE.md` | the map: what owns what, what there is exactly one of, the invariants |
| `docs/HOW-WE-BUILD.md` | the working agreement — which paths get full review, what must be updated alongside the code |
| `docs/BACKLOG.md` | every known gap and deferred decision, with why |
| `docs/PRODUCTION-READINESS-PLAN.md` | the ordered programme for the platform |
| `docs/ubo/P0-ROWS.md` | the UBO module's sixteen readiness rows and what is done |
| `docs/ubo/SERVICE-BOUNDARY.md` | what the UBO module offers a host system, and what the host must bring |
| `docs/ubo/SCHEMA-PROPOSAL.md` | a proposed shape for UBO's tables. Nothing applied. |

## 8. Things that will look broken and are

Kept honest rather than tidy — an unexplained failure wastes an afternoon.

- **Two pre-existing lint errors** in `api/idv-match/` and one in a test file.
  Everything else is clean. Tracked as PLAT-10.
- **`npm ci` does not work**; use `npm install`. The lockfile is incomplete and
  regenerating it on Windows has produced a broken one. Tracked as PROC-5.
- **The Evidence Lab (`/evidence-lab`, `/api/evidence/*`) is refused on purpose**
  in any deployment. It is a local tool.
