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
// Paid AI steps for the whole trial, all seats together: every research run,
// every document reading (an ownership chart or evidence) and every AI name
// check counts one (lib/rateLimit.js, the paid buckets).
const DEFAULT_BUDGET = 100;
const MAX_BUDGET = 10000;

let _deps = { storage: require("./storage"), userAccess, now: () => Date.now() };

const inviteKey = (code) => `ubo-invite:${String(code).toUpperCase()}`;
const trialKey = (userId) => `ubo-trial:${userId}`;
const spendKey = (code) => `ubo-trial-spend:${String(code).toUpperCase()}`;
// Whose trial a workspace belongs to: a customer works inside the inviting
// analyst's workspace, and their paid steps are that trial's (UBO-48).
const workspaceKey = (tenantId) => `ubo-trial-workspace:${tenantId}`;

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
      customer: invite.customer || null,
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
  if (existing) {
    // Trials joined before the workspace record existed (UBO-48) get it here.
    if (existing.tenantId) await _deps.storage.set(workspaceKey(existing.tenantId), userId);
    return { ok: true, access: existing, alreadyRedeemed: true };
  }

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
  await _deps.storage.set(workspaceKey(access.tenantId), userId);
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

/** Marks (or unmarks) the company behind a code as a paying customer.
 *
 *  This is what separates a buyer from a non-buyer: a non-buyer's workspaces are
 *  deleted 90 days after the trial ends (owner decision, 2026-09-30); a
 *  customer's are kept under the seven-year rule in lib/uboRetention.js. Kept
 *  with who and when, because it decides whether data survives. */
/** Changes a trial's paid AI steps after the link has gone out. What was spent
 *  stays spent; raising it lets a used-up trial carry on. Owner only - the
 *  route checks. */
async function setBudget(code, budget) {
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_BUDGET) {
    throw Object.assign(new Error("A budget is a whole number from 1 to 10,000."), { code: "budget_invalid" });
  }
  const invite = await getInvite(code);
  if (!invite) return null;
  const updated = { ...invite, budget };
  await _deps.storage.set(inviteKey(invite.code), updated);
  return updated;
}

async function markCustomer(code, { customer, by }) {
  const invite = await getInvite(code);
  if (!invite) return false;
  const mark = customer ? { markedAt: new Date(_deps.now()).toISOString(), markedBy: by || null } : null;
  await _deps.storage.set(inviteKey(invite.code), { ...invite, customer: mark });
  return true;
}

/** Trials by companies that did not buy, whose data is now due for deletion:
 *  TRIAL_DELETE_AFTER_DAYS after the trial ended (lib/uboRetention.js). */
async function dueForDeletion(now = _deps.now()) {
  const afterMs = retention.TRIAL_DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const invites = [];
  for (const code of await listCodes()) {
    const invite = await getInvite(code);
    if (invite) invites.push(invite);
  }
  // The mark is made on one code but means the company: a second code for the
  // same company (more seats, a re-sent link) is covered by it too.
  const companyKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const customers = new Set(invites.filter((invite) => invite.customer).map((invite) => companyKey(invite.company)));
  const due = [];
  for (const invite of invites) {
    if (customers.has(companyKey(invite.company))) continue;
    for (const { userId } of invite.redeemedBy || []) {
      const trial = await _deps.storage.get(trialKey(userId));
      if (!trial) continue; // already forgotten
      const deleteFrom = Date.parse(trial.trialEndsAt) + afterMs;
      if (Number.isFinite(deleteFrom) && now >= deleteFrom) {
        due.push({ userId, tenantId: trial.tenantId, code: invite.code, company: invite.company, trialEndsAt: trial.trialEndsAt });
      }
    }
  }
  return due;
}

/** After a trial workspace's data is deleted: forget the person too - their
 *  trial record and the email on the invite - and keep one line saying the
 *  workspace existed and when it went. */
async function forgetTrial({ userId, tenantId, code, company }, { deletedAt }) {
  await _deps.storage.set(`ubo-trial-deleted:${tenantId}`, { tenantId, company, deletedAt });
  const invite = await getInvite(code);
  if (invite) {
    await _deps.storage.set(inviteKey(invite.code), {
      ...invite,
      redeemedBy: (invite.redeemedBy || []).map((entry) => (entry.userId === userId ? { ...entry, email: null, deletedAt } : entry)),
    });
  }
  // The person's trial record, and which trial their workspace belonged to.
  for (const key of [trialKey(userId), workspaceKey(tenantId)]) await _deps.storage.del(key);
}

async function recordSpend(userId, units = 1) {
  const trial = await _deps.storage.get(trialKey(userId));
  if (!trial) return null;
  const key = spendKey(trial.code);
  const spent = (Number(await _deps.storage.get(key)) || 0) + units;
  await _deps.storage.set(key, spent);
  return spent;
}

/** The trial member whose workspace this is, or null for a workspace that is
 *  not a trial's. */
async function memberForWorkspace(tenantId) {
  if (!tenantId) return null;
  return (await _deps.storage.get(workspaceKey(tenantId))) || null;
}

/** Whose trial pays for this caller's step: staff pay their own; a customer's
 *  is the inviting trial's (UBO-48) - never the customer's own sign-in, which
 *  belongs to no trial. */
async function payerFor(actor) {
  if (actor?.kind === "staff") return actor.userId || null;
  if (actor?.kind === "customer") return memberForWorkspace(actor.tenantId);
  return null;
}

/** One paid AI step for a trial, counted where the paid call actually starts
 *  (UBO-44): a request refused for sign-in or workspace, or answered from the
 *  cache, spends nothing and must not use up a step. Spend control, not access
 *  control: a storage failure is logged, never fatal. */
async function countPaidStep(actor) {
  try {
    const payer = await payerFor(actor);
    if (!payer) return null;
    return await recordSpend(payer);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ubo-trials] could not count a paid step:", err && err.message);
    return null;
  }
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
  dueForDeletion,
  forgetTrial,
  markCustomer,
  setBudget,
  createInvite,
  getInvite,
  listInvites,
  redeem,
  revokeInvite,
  recordSpend,
  countPaidStep,
  memberForWorkspace,
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
