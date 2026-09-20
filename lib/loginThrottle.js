// Slows down password guessing on the login routes (AUTH-1).
//
// Before this, a wrong password returned a fast 401 as many times as anyone
// cared to try, against every login in the product.
//
// Counted on FAILURES, never attempts, and a success clears the count - so
// somebody mistyping their own password three times is not treated like an
// attacker. Two windows, because attacks come in two shapes:
//
//   account  5 failures / 15 minutes   one password tried many times
//   address  20 failures / hour        one weak password tried across accounts
//
// Deliberately fails OPEN. Failing closed would lock every admin out of every
// tenant during a storage blip, which is a worse outcome than a guessing window
// while the store is down - and the failure is logged.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");

const ACCOUNT_LIMIT = 5;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const ADDRESS_LIMIT = 20;
const ADDRESS_WINDOW_MS = 60 * 60 * 1000;

let _deps = { storage, now: () => Date.now() };

function windowKey(kind, id, windowMs) {
  const start = Math.floor(_deps.now() / windowMs) * windowMs;
  return `login-fail:${kind}:${id}:${start}`;
}

function retryAfterSeconds(windowMs) {
  const start = Math.floor(_deps.now() / windowMs) * windowMs;
  return Math.max(1, Math.ceil((start + windowMs - _deps.now()) / 1000));
}

async function countOf(key) {
  return Number(await _deps.storage.get(key)) || 0;
}

/** @returns {Promise<{blocked: boolean, scope?: string, retryAfterSeconds?: number}>} */
async function check({ account, ip }) {
  try {
    if (account) {
      const failures = await countOf(windowKey("account", account, ACCOUNT_WINDOW_MS));
      if (failures >= ACCOUNT_LIMIT) {
        return { blocked: true, scope: "account", retryAfterSeconds: retryAfterSeconds(ACCOUNT_WINDOW_MS) };
      }
    }
    if (ip) {
      const failures = await countOf(windowKey("address", ip, ADDRESS_WINDOW_MS));
      if (failures >= ADDRESS_LIMIT) {
        return { blocked: true, scope: "address", retryAfterSeconds: retryAfterSeconds(ADDRESS_WINDOW_MS) };
      }
    }
    return { blocked: false };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[login-throttle] check failed, allowing the attempt:", err && err.message);
    return { blocked: false };
  }
}

async function recordFailure({ account, ip }) {
  try {
    if (account) {
      const key = windowKey("account", account, ACCOUNT_WINDOW_MS);
      await _deps.storage.set(key, (await countOf(key)) + 1, { ttlSeconds: Math.ceil(ACCOUNT_WINDOW_MS / 1000) });
    }
    if (ip) {
      const key = windowKey("address", ip, ADDRESS_WINDOW_MS);
      await _deps.storage.set(key, (await countOf(key)) + 1, { ttlSeconds: Math.ceil(ADDRESS_WINDOW_MS / 1000) });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[login-throttle] could not record a failure:", err && err.message);
  }
}

/** Clears the account's count. The address count deliberately survives: one
 *  correct password does not vouch for everything else tried from there. */
async function recordSuccess({ account }) {
  if (!account) return;
  const key = windowKey("account", account, ACCOUNT_WINDOW_MS);
  try {
    if (typeof _deps.storage.del === "function") await _deps.storage.del(key);
    else await _deps.storage.set(key, 0, { ttlSeconds: 1 });
  } catch (_) {
    // A failure to clear only means the person waits out the window.
  }
}

function sendLocked(res, { scope, retryAfterSeconds: retryAfter }) {
  const minutes = Math.ceil(retryAfter / 60);
  const body = {
    error: "too_many_attempts",
    scope,
    retryAfterSeconds: retryAfter,
    message: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
  if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(retryAfter));
  if (typeof res.status === "function" && typeof res.json === "function") return res.status(429).json(body);
  res.statusCode = 429;
  return res.end(JSON.stringify(body));
}

module.exports = {
  check,
  recordFailure,
  recordSuccess,
  sendLocked,
  ACCOUNT_LIMIT,
  ADDRESS_LIMIT,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
