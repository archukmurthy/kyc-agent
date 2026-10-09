// Who works for which company, and as what.
//
// Clerk answers "is this really that person" (lib/clerkAuth.js). This answers
// "what may that person see". We keep it rather than Clerk so the company list
// stays in one place - the same place lib/tenantRegistry.js already lives -
// instead of two lists that drift apart until somebody is in one and not the
// other.
//
// Roles:
//   owner    platform-wide, not bound to a company. Adds and removes everyone.
//   admin    one company; manages that company's people and settings.
//   analyst  one company; does the work.
//
// The first owner comes from PLATFORM_OWNER_CLERK_IDS rather than from the
// list, because the list starts empty and nobody could sign in to fill it. That
// setting also wins over a stored row, so an owner cannot be locked out by a
// bad grant - the way back in is configuration only the deployer controls.
//
// CommonJS so api/ handlers and scripts can require it.

const storage = require("./storage");

const ROLES = Object.freeze(["owner", "admin", "analyst"]);
const INDEX_KEY = "user-access:index";
const PENDING_INDEX_KEY = "user-access:pending-index";

let _deps = { storage, now: () => new Date().toISOString() };

function accessKey(userId) {
  return `user-access:${userId}`;
}

function normaliseEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function pendingKey(email) {
  return `user-access:pending:${normaliseEmail(email)}`;
}

function bootstrapOwners() {
  return String(process.env.PLATFORM_OWNER_CLERK_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** @returns {Promise<{userId, tenantId, role, addedAt?, addedBy?, source} | null>} */
async function getAccess(userId) {
  if (!userId) return null;

  if (bootstrapOwners().includes(userId)) {
    // Always an owner - a stored row never demotes one. But an owner who has
    // joined a trial (to try or demo it) works in that trial's workspace; without
    // it every case step answered tenant_required (found in the browser test).
    let joined = null;
    try { joined = await _deps.storage.get(accessKey(userId)); } catch (_) { joined = null; }
    return { userId, tenantId: (joined && joined.tenantId) || null, role: "owner", source: "bootstrap" };
  }

  try {
    const stored = await _deps.storage.get(accessKey(userId));
    if (!stored || !stored.role) return null;
    return { userId, ...stored, source: "stored" };
  } catch (err) {
    // Fail closed. An unreadable list means we cannot say what someone may do,
    // and "cannot say" must never resolve to "anything".
    // eslint-disable-next-line no-console
    console.warn("[user-access] lookup failed, denying:", err && err.message);
    return null;
  }
}

async function grantAccess({ userId, tenantId = null, role, addedBy = null, email = null }) {
  if (!userId) throw new Error("a grant needs a userId");
  if (!ROLES.includes(role)) throw new Error(`unknown role "${role}" - expected one of ${ROLES.join(", ")}`);
  if (role !== "owner" && !tenantId) throw new Error("a tenant is required for every role except owner");

  const record = { tenantId: role === "owner" ? null : tenantId, role, email, addedAt: _deps.now(), addedBy };
  await _deps.storage.set(accessKey(userId), record);

  // A small index so people can be listed per company. Kept beside the rows
  // rather than derived, because the storage layer cannot scan keys.
  await addToIndex(INDEX_KEY, userId);
  return { userId, ...record };
}

// The indexes change in one atomic step. They used to be read, changed and
// written back - and a failed read was taken as an empty list, so one storage
// blip wrote back a list of one and wiped everybody else from the screens and
// from the trial-deletion sweep; two grants at once lost one (review,
// 2026-10-09).
function addToIndex(key, item) {
  return _deps.storage.update(key, (index) => {
    const list = Array.isArray(index) ? index : [];
    return list.includes(item) ? undefined : list.concat(item);
  });
}

function removeFromIndex(key, item) {
  return _deps.storage.update(key, (index) => (Array.isArray(index) && index.includes(item) ? index.filter((x) => x !== item) : undefined));
}

async function revokeAccess(userId) {
  if (!userId) return false;
  await _deps.storage.del(accessKey(userId));
  await removeFromIndex(INDEX_KEY, userId);
  return true;
}

/** Invites somebody who has never signed in.
 *
 *  A grant is keyed by Clerk user id, and nobody has one until they sign in -
 *  so an admin adding a colleague has nothing to type. This holds the grant
 *  against their email address until they arrive, which is the order real life
 *  happens in: invite first, sign in second.
 */
async function inviteByEmail({ email, tenantId = null, role, addedBy = null }) {
  const address = normaliseEmail(email);
  if (!address || !address.includes("@")) throw new Error("an invitation needs an email address");
  if (!ROLES.includes(role)) throw new Error(`unknown role "${role}" - expected one of ${ROLES.join(", ")}`);
  if (role !== "owner" && !tenantId) throw new Error("a tenant is required for every role except owner");

  const record = {
    email: address,
    tenantId: role === "owner" ? null : tenantId,
    role,
    invitedAt: _deps.now(),
    addedBy,
  };
  await _deps.storage.set(pendingKey(address), record);
  await addToIndex(PENDING_INDEX_KEY, address);
  return record;
}

/** Turns a waiting invitation into real access, once we know who signed in.
 *
 *  The email MUST be one Clerk has verified (lib/clerkAuth.js#verifiedEmailFor).
 *  An address taken from a request body would let any signed-in stranger claim
 *  the grant left waiting for somebody else.
 *
 *  @returns the new access, or null when nothing was waiting.
 */
async function claimByEmail(userId, verifiedEmail) {
  const address = normaliseEmail(verifiedEmail);
  if (!userId || !address) return null;

  let pending;
  try {
    pending = await _deps.storage.get(pendingKey(address));
  } catch (err) {
    // Fail closed, same as getAccess: unreadable means "no".
    // eslint-disable-next-line no-console
    console.warn("[user-access] pending lookup failed, denying:", err && err.message);
    return null;
  }
  if (!pending || !pending.role) return null;

  const access = await grantAccess({
    userId,
    tenantId: pending.tenantId,
    role: pending.role,
    email: address,
    addedBy: pending.addedBy,
  });
  await cancelInvite(address);
  return access;
}

/** Withdraws an invitation nobody has claimed yet. */
async function cancelInvite(email) {
  const address = normaliseEmail(email);
  if (!address) return false;
  await _deps.storage.del(pendingKey(address));
  await removeFromIndex(PENDING_INDEX_KEY, address);
  return true;
}

// Listing THROWS when storage cannot be read. An empty answer would show an
// empty screen as if everyone had gone, and the trial-deletion sweep would
// skip revoking the people it could not see (lib/uboTrialPurge.js).
async function readList(key) {
  const index = await _deps.storage.get(key);
  return Array.isArray(index) ? index : [];
}

/** Invitations not yet claimed, for one company or all of them. */
async function listPending(tenantId = null) {
  const out = [];
  for (const address of await readList(PENDING_INDEX_KEY)) {
    const pending = await _deps.storage.get(pendingKey(address));
    if (!pending || !pending.role) continue;
    if (tenantId && pending.tenantId !== tenantId) continue;
    out.push(pending);
  }
  return out;
}

/** Everyone in one company, or everyone if no company is named. */
async function listAccess(tenantId = null) {
  const out = [];
  for (const userId of await readList(INDEX_KEY)) {
    const stored = await _deps.storage.get(accessKey(userId));
    const access = bootstrapOwners().includes(userId)
      ? { userId, tenantId: (stored && stored.tenantId) || null, role: "owner", source: "bootstrap" }
      : stored && stored.role ? { userId, ...stored, source: "stored" } : null;
    if (!access) continue;
    if (tenantId && access.tenantId !== tenantId) continue;
    out.push(access);
  }
  return out;
}

module.exports = {
  getAccess,
  grantAccess,
  revokeAccess,
  listAccess,
  inviteByEmail,
  claimByEmail,
  cancelInvite,
  listPending,
  bootstrapOwners,
  ROLES,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
