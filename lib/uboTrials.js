// Trial invites for the UBO module.
//
// The problem this solves: we do not know a prospect's email address in
// advance, and "sign up, then wait for somebody to add you" kills a trial that
// starts at 9pm. An invite code travels with the link instead, so they are
// working the moment they click.
//
// Shape of it:
//   one code per company, several seats, a fixed number of days
//   each person who redeems gets THEIR OWN workspace, never a shared one
//   the clock starts at first sign-in, so a link opened late still gives a
//   full trial
//   expiry freezes the work rather than deleting it
//   a spend budget that does not reset, because the money does not come back
//
// The email is stored deliberately. Clerk cannot move accounts between
// instances, so moving to a real domain gives everyone a new user id; the
// verified email is the stable identity that lets their work be re-linked
// rather than orphaned.
//
// CommonJS so api/ handlers and scripts can require it.

const crypto = require("node:crypto");
const userAccess = require("./userAccess");
const retention = require("./uboRetention");

const DEFAULT_DAYS = 7;
const DEFAULT_SEATS = 5;
const DEFAULT_BUDGET = 100; // AI calls for the whole trial, all seats together

let _deps = { storage: require("./storage"), userAccess, now: () => Date.now() };

const inviteKey = (code) => `ubo-invite:${String(code).toUpperCase()}`;
const trialKey = (userId) => `ubo-trial:${userId}`;
const spendKey = (code) => `ubo-trial-spend:${String(code).toUpperCase()}`;

// No I, O, 0 or 1: a code gets read down a phone and typed from a screenshot.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(company) {
  const prefix = String(company || "TRIAL").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "TRIAL";
  let suffix = "";
  for (const byte of crypto.randomBytes(4)) suffix += ALPHABET[byte % ALPHABET.length];
  return `${prefix}-${suffix}`;
}

/** A workspace id per person, prefixed by the company so a support question is
 *  answerable without a database lookup. */
function workspaceFor(company, userId) {
  const slug = String(company || "trial").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "trial";
  const suffix = crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 8);
  return `trial-${slug}-${suffix}`;
}

async function createInvite({ company, seats = DEFAULT_SEATS, days = DEFAULT_DAYS, budget = DEFAULT_BUDGET, createdBy = null } = {}) {
  if (!company) throw new Error("an invite needs a company name");
  const code = randomCode(company);
  const invite = {
    code,
    company,
    seats: Number(seats) || DEFAULT_SEATS,
    days: Number(days) || DEFAULT_DAYS,
    budget: Number(budget) || DEFAULT_BUDGET,
    seatsUsed: 0,
    redeemedBy: [],
    revoked: false,
    createdBy,
    createdAt: new Date(_deps.now()).toISOString(),
  };
  await _deps.storage.set(inviteKey(code), invite);
  await addToIndex(code);
  return invite;
}

async function getInvite(code) {
  if (!code) return null;
  try {
    return await _deps.storage.get(inviteKey(code));
  } catch (_) {
    return null;
  }
}

async function addToIndex(code) {
  const index = await listCodes();
  if (!index.includes(code)) await _deps.storage.set("ubo-invite:index", index.concat(code));
}

async function listCodes() {
  try {
    const index = await _deps.storage.get("ubo-invite:index");
    return Array.isArray(index) ? index : [];
  } catch (_) {
    return [];
  }
}

/** Every invite, with how much of its research budget has been used.
 *
 *  The spend is stored against the code and was being counted by nothing until
 *  UBO-3; now that it is a real number it is worth showing. It answers the two
 *  questions somebody running a trial actually has: which prospect is
 *  evaluating and which signed in once and vanished, and who is about to run
 *  out before they complain about it.
 */
async function listInvites() {
  const out = [];
  for (const code of await listCodes()) {
    const invite = await getInvite(code);
    if (!invite) continue;
    const budgetSpent = Number(await _deps.storage.get(spendKey(code))) || 0;
    out.push({
      ...invite,
      budgetSpent,
      budgetLeft: Math.max(0, invite.budget - budgetSpent),
      // The same threshold the spend ceiling alerts on, so one number means one
      // thing across the product.
      nearlySpent: invite.budget > 0 && budgetSpent >= invite.budget * 0.85,
    });
  }
  return out;
}

/** Turns a code into access. Idempotent: reloading the page must not cost a
 *  seat, and must not restart anyone's clock. */
async function redeem({ code, userId, email }) {
  if (!userId) return { ok: false, reason: "no_user" };

  const existing = await _deps.storage.get(trialKey(userId));
  if (existing) return { ok: true, access: existing, alreadyRedeemed: true };

  const invite = await getInvite(code);
  // Deliberately the same answer for "never existed" and "wrong": a code
  // checker should not be able to tell one from the other.
  if (!invite) return { ok: false, reason: "invite_invalid" };
  if (invite.revoked) return { ok: false, reason: "invite_revoked" };
  if (invite.seatsUsed >= invite.seats) return { ok: false, reason: "invite_full" };

  const now = _deps.now();
  const access = {
    userId,
    email: email || null,
    code: invite.code,
    company: invite.company,
    tenantId: workspaceFor(invite.company, userId),
    role: "analyst",
    // The clock starts now, not when the link was made.
    trialStartedAt: new Date(now).toISOString(),
    trialEndsAt: new Date(now + invite.days * 24 * 60 * 60 * 1000).toISOString(),
  };

  // The trial ENDS in days; the record is KEPT for years. Two different clocks,
  // and confusing them is how a prospect's work gets thrown away at the end of
  // an evaluation. See lib/uboRetention.js.
  const stamped = retention.withRetention(access, new Date(now));

  await _deps.storage.set(trialKey(userId), stamped);
  await _deps.storage.set(inviteKey(invite.code), {
    ...invite,
    seatsUsed: invite.seatsUsed + 1,
    redeemedBy: invite.redeemedBy.concat({ userId, email: email || null, at: access.trialStartedAt }),
  });

  // The access list is the one place that answers "what may this person see".
  await _deps.userAccess.grantAccess({
    userId,
    tenantId: access.tenantId,
    role: "analyst",
    email: email || null,
    addedBy: `invite:${invite.code}`,
  });

  return { ok: true, access: stamped };
}

/** Revokes the link. People already inside keep working: revoking a link that
 *  reached the wrong inbox should not evict a prospect mid-evaluation. */
async function revokeInvite(code) {
  const invite = await getInvite(code);
  if (!invite) return false;
  await _deps.storage.set(inviteKey(invite.code), { ...invite, revoked: true, revokedAt: new Date(_deps.now()).toISOString() });
  return true;
}

async function recordSpend(userId, units = 1) {
  const trial = await _deps.storage.get(trialKey(userId));
  if (!trial) return null;
  const key = spendKey(trial.code);
  const spent = (Number(await _deps.storage.get(key)) || 0) + units;
  await _deps.storage.set(key, spent);
  return spent;
}

/** Everything a route or screen needs to decide what this person may do. */
async function statusFor(userId) {
  const trial = await _deps.storage.get(trialKey(userId));
  if (!trial) return { inTrial: false };

  const invite = await getInvite(trial.code);
  const budget = invite ? invite.budget : DEFAULT_BUDGET;
  const budgetSpent = Number(await _deps.storage.get(spendKey(trial.code))) || 0;
  const expired = _deps.now() >= Date.parse(trial.trialEndsAt);
  const overBudget = budgetSpent >= budget;

  return {
    inTrial: true,
    company: trial.company,
    tenantId: trial.tenantId,
    email: trial.email,
    trialEndsAt: trial.trialEndsAt,
    expired,
    // Expiry freezes rather than deletes. If they come back to buy, their work
    // still being there is a good moment.
    readOnly: expired || overBudget,
    budget,
    budgetSpent,
    budgetLeft: Math.max(0, budget - budgetSpent),
    overBudget,
  };
}

module.exports = {
  createInvite,
  getInvite,
  listInvites,
  redeem,
  revokeInvite,
  recordSpend,
  statusFor,
  DEFAULT_DAYS,
  DEFAULT_SEATS,
  DEFAULT_BUDGET,
};

// Test seam only.
module.exports.__setDeps = (d) => {
  _deps = { ..._deps, ...d };
  if (d && d.storage && !d.userAccess) {
    // Tests that stub storage expect the access list to use the same one.
    _deps.userAccess.__setDeps({ storage: d.storage });
  }
};
