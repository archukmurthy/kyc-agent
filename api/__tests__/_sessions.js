"use strict";

// Minting the sessions that logins now hand out (AUTH-2).
//
// Tests used to authenticate by putting the password in the Authorization
// header, because that is what a successful login returned. Nothing accepts a
// password as a bearer any more: it is checked once, against the request body,
// at the three login routes. So a test that needs to be signed in mints the
// same session those routes mint.
//
// A session names the company it was issued for, which is why these take a
// tenant: an admin session for one tenant does not open another's, and that is
// a rule worth having tests exercise rather than work around.

const session = require("../../lib/session");

if (!process.env.SESSION_SECRET && !process.env.DOSSIER_TOKEN_SECRET) {
  process.env.SESSION_SECRET = "test-session-secret-not-used-anywhere-real";
}

const adminToken = (tenantId) => session.mint({ subject: `admin:${tenantId}`, tenantId, role: "admin" });
const analystToken = (tenantId) => session.mint({ subject: `analyst:${tenantId}`, tenantId, role: "analyst" });
const superAdminToken = () => session.mint({ subject: "super-admin", role: "super-admin" });

/** Ready-made Authorization headers. */
const asAdmin = (tenantId) => ({ authorization: `Bearer ${adminToken(tenantId)}` });
const asAnalyst = (tenantId) => ({ authorization: `Bearer ${analystToken(tenantId)}` });
const asSuperAdmin = () => ({ authorization: `Bearer ${superAdminToken()}` });

module.exports = { adminToken, analystToken, superAdminToken, asAdmin, asAnalyst, asSuperAdmin };
