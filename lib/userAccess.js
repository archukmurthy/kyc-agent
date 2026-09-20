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

let _deps = { storage, now: () => new Date().toISOString() };

function accessKey(userId) {
  return `user-access:${userId}`;
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
    return { userId, tenantId: null, role: "owner", source: "bootstrap" };
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
  const index = (await readIndex()).filter((id) => id !== userId).concat(userId);
  await _deps.storage.set(INDEX_KEY, index);
  return { userId, ...record };
}

async function revokeAccess(userId) {
  if (!userId) return false;
  if (typeof _deps.storage.del === "function") await _deps.storage.del(accessKey(userId));
  else await _deps.storage.set(accessKey(userId), null);
  await _deps.storage.set(INDEX_KEY, (await readIndex()).filter((id) => id !== userId));
  return true;
}

async function readIndex() {
  try {
    const index = await _deps.storage.get(INDEX_KEY);
    return Array.isArray(index) ? index : [];
  } catch (_) {
    return [];
  }
}

/** Everyone in one company, or everyone if no company is named. */
async function listAccess(tenantId = null) {
  const out = [];
  for (const userId of await readIndex()) {
    const access = await getAccess(userId);
    if (!access) continue;
    if (tenantId && access.tenantId !== tenantId) continue;
    out.push(access);
  }
  return out;
}

module.exports = { getAccess, grantAccess, revokeAccess, listAccess, bootstrapOwners, ROLES };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
