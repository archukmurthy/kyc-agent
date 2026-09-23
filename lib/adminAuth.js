// Is this bearer token a tenant admin?
//
// Lifted out of api/config.js so every admin-gated route shares one check.
// Three near-identical copies existed (config, config-templates, config-versions)
// and a route with no check at all (change-intelligence-metrics); duplicated
// auth is how those drift apart.
//
// The bearer is a SESSION, not a password. Until 2026-09-23 a successful login
// handed the password straight back as the token, so the password itself was
// re-sent on every request - it could not expire, could not be revoked without
// changing it for everybody, and a captured token was a captured password
// (AUTH-2). Passwords are now checked once, at the login routes, against the
// body; nothing accepts one as a bearer.
//
// Known weakness that remains, tracked as PLAT-2: the stored password hash is
// not a password KDF. That is about how the password is stored, not about what
// travels on each request.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");
const session = require("./session");

let _deps = { storage, session };

function authKey(tenantId) {
  return `tenant-auth:${tenantId}`;
}

async function authorizeAdmin(tenant, token, deps = {}) {
  if (!token || !tenant) return false;

  const result = await (deps.session || _deps.session).verify(token);
  if (!result.valid) return false;

  // A session for one company is not a session for another, and an analyst's
  // session is not an admin's. Both are checked here rather than trusted from
  // the signature alone: the signature proves we issued it, not what for.
  if (result.payload.role !== "admin") return false;
  return result.payload.tenantId === tenant;
}

module.exports = { authorizeAdmin, authKey };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
