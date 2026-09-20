# Batch 1 - Proper logins

Guarded work. Readiness plan items 1.1-1.6, plus H2.

**If this is built badly:** a leaked password stays valid forever, one tenant's
staff can act on another tenant by editing a URL, and a stolen browser session
cannot be cut off. Every later batch assumes this one is right.

## What is wrong today

- `lib/auth.js#hashPassword` is a 32-bit rolling hash with a fixed public salt.
  Not a KDF. A copy of the store yields the passwords.
- `api/admin-auth.js` returns the password itself as the browser's token
  (lines 122, 134). It never expires and cannot be revoked.
- Nothing throttles guessing on any login route.
- `requireAdmin` reads the tenant from `?tenant=`, so the credential does not
  bind to a tenant. One shared `PREBOARDING_PASSWORD` opens every tenant.

## Design

**Passwords** - `lib/password.js`, scrypt from `node:crypto` (no new dependency,
a real KDF). Stored as `scrypt$N$r$p$salt$hash`. `verify()` also accepts the
legacy format and reports `needsRehash`, so a correct login upgrades the stored
hash in place. No forced reset, no lockout of existing users.

**Sessions** - `lib/session.js`, HMAC-signed like `lib/dossierToken.js`:
`{ sub, tenantId, role, jti, exp }`. 12 hours. Revocation is a `session-revoked:<jti>`
key in `lib/storage.js` that outlives the token. Secret: `SESSION_SECRET`, falling
back to `DOSSIER_TOKEN_SECRET`, with domain separation.

**Where the password still works** - only at the login routes. Every other route
takes a session. This is the point of the batch, and it breaks two callers we
own: `benchmark/run.mjs` and any bookmarked admin tab (one re-login).

**Tenant from identity** - `requireAdmin` returns the tenant inside the session,
never the query string. A request whose `?tenant=` disagrees with the session is
refused rather than silently preferred.

## Tasks

**Paused after task 2 on 2026-09-20** - other work took priority. Tasks 1 and 2
are merged and inert: the libraries exist with tests, nothing imports them yet,
and no behaviour changed. Resume at task 3; nothing is half-wired.

1. DONE (30d1a6d) `lib/password.js` + tests - scrypt hash/verify, legacy verify, needsRehash.
2. DONE (30d1a6d) `lib/session.js` + tests - mint/verify/revoke, expiry, tamper, domain separation.
3. Login routes - issue sessions, throttle guessing, rehash on success.
4. `lib/routeAuth.js#requireAdmin` - verify session, derive tenant from it.
5. Clients - AdminRoot, SuperAdminRoot, dashboard, App.js preview, benchmark script.
6. Per-tenant pre-boarding password, seeded from the env value on first use.
7. Rotation notes in `.env.example` + BACKLOG/readiness updates.

## Verification

- Old password format still logs in once, and the stored hash is upgraded.
- An expired session is refused; a revoked session is refused immediately.
- A session for tenant A cannot act on tenant B, whatever `?tenant=` says.
- Repeated wrong passwords are throttled.
- Full node + frontend suites and a clean build before the pull request.
