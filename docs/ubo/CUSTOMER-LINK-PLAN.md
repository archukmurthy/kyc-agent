# The UBO customer link

Owner decision, 2026-09-29, agreed by the UBO product owner: a customer reaches
their case through a server-made, single-case, **recipient-bound** link, valid
30 days (a setting) and revocable. Opening it needs a one-time code emailed to
the recipient; the session it starts lasts hours, not 30 days.

**What goes wrong if this is built badly:** a customer's link is a key to a
compliance case - who owns a company, the documents that prove it, identity
checks. Forwarded, guessed, replayed or widened, it hands a stranger someone
else's case, or lets a customer act as the analyst.

## Shape

- **Link token** (`lib/uboCustomerLink.js`): HMAC-signed `{ caseId, tenantId,
  emailHash, iat, exp }`, domain-separated from dossier links and staff
  sessions. Revocation is per case ("every link for this case issued before
  now is dead"), like `lib/dossierToken.js`.
- **The emailed code is Clerk's.** Without a domain our own email provider
  (Resend) can only mail the account owner, so the customer signs in with
  Clerk's email code; the server compares Clerk's *verified* email with the
  link's. No password. Clerk must allow email-code sign-in (dashboard).
- **Customer session**: exchanging a valid link + matching verified email
  mints an 8-hour session scoped to `{ caseId, tenantId }`, sent as
  `x-ubo-customer-session`. Kept in memory in the browser, never in storage.
- **Route** `api/ubo-customer-link.js`: `create` and `revoke` (analyst, own
  workspace, case must exist), `open` (the customer exchange).
- **Gate**: the UBO routes accept either a staff caller (Clerk) or a customer
  session. A customer may read and write only their own case, only the
  customer operations, upload charts only for it and follow only its jobs;
  never research, never analyst operations. `actorType` is set by the server
  from who the caller is.
- Local development with Clerk off: the link alone opens it, never on Vercel.

## Tests, per piece

Forged, expired, revoked and other-purpose tokens refused; a signed-in person
with a different verified email refused; a customer session cannot read
another case, run research, save research or analyst state, start a chart for
another case or follow another case's job; staff paths unchanged.
