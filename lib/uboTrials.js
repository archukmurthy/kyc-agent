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
// Every change to a stored record is ONE atomic step (lib/storage.js update /
// incr). They used to be read, changed and written back: two people redeeming
// at once both took "seat 3" and one of them vanished from the invite - and so
// from the deletion sweep, which kept their data forever (review, 2026-10-09).
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
const INDEX_KEY = "ubo-invite:index";

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

/** Every trial workspace is named by workspaceFor. Anything else is not a
 *  trial's, which spares every other workspace the trial lookups. */
function isTrialWorkspace(tenantId) {
  return typeof tenantId === "string" && tenantId.startsWith("trial-");
}

async function createInvite({ company, seats = DEFAULT_SEATS, days = DEFAULT_DAYS, budget = DEFAULT_BUDGET, createdBy = null } = {}) {
  if (!company) throw new Error("an invite needs a company name");
  // Four random letters: a clash is rare, and overwriting a live invite with a
  // new one would hand its seats and budget to a stranger. Only an unused code
  // is written.
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
    let fresh = false;
    await _deps.storage.update(inviteKey(code), (current) => {
      fresh = !current;
      return current ? undefined : invite;
    });
    if (fresh) {
      await addToIndex(code);
      return invite;
    }
  }
  throw new Error("could not find an unused invite code");
}

/** Throws when storage cannot be read: "no such invite" and "could not look"
 *  are different answers, and treating the second as the first gave a trial
 *  the default budget instead of its own. */
async function getInvite(code) {
  if (!code) return null;
  return _deps.storage.get(inviteKey(code));
}

/** Changes an invite in one atomic step. `change` gets the stored invite and
 *  answers the new one (or undefined for no change); it is not called for an
 *  invite that does not exist. Answers what is stored, or null. */
async function changeInvite(code, change) {
  if (!code) return null;
  let found = false;
  const stored = await _deps.storage.update(inviteKey(code), (invite) => {
    found = Boolean(invite);
    return invite ? change(invite) : undefined;
  });
  return found ? stored : null;
}

function addToIndex(code) {
  return _deps.storage.update(INDEX_KEY, (index) => {
    const list = Array.isArray(index) ? index : [];
    return list.includes(code) ? undefined : list.concat(code);
  });
}

/** Throws when the index cannot be read - see lib/userAccess.js readList. */
async function listCodes() {
  const index = await _deps.storage.get(INDEX_KEY);
  return Array.isArray(index) ? index : [];
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

const sameCode = (a, b) => String(a || "").toUpperCase() === String(b || "").toUpperCase();

/** Turns a code into access. Idempotent: reloading the page must not cost a
 *  seat, and must not restart anyone's clock - also when the same person's two
 *  requests arrive together (the page runs its start-up twice). */
async function redeem({ code, userId, email }) {
  if (!userId) return { ok: false, reason: "no_user" };

  const existing = await _deps.storage.get(trialKey(userId));
  if (existing) {
    // One login, one trial (owner decision, 2026-10-03). Another trial's link
    // used to hand back the first trial without a word, so a second company's
    // work and paid steps landed in it. Their own link again is a reload.
    if (!sameCode(existing.code, code)) {
      // Which trial is not said: whoever is looking at the screen does not
      // need the client's name to know what to do.
      return { ok: false, reason: "already_in_trial" };
    }
    // Trials joined before the workspace record existed (UBO-48) get it here.
    if (existing.tenantId) await _deps.storage.set(workspaceKey(existing.tenantId), userId);
    return { ok: true, access: existing, alreadyRedeemed: true };
  }

  const now = _deps.now();
  const startedAt = new Date(now).toISOString();
  // The seat is taken in one step with the checks, so two people can never
  // both take the last one. A person already listed (their other request got
  // there first, or a redeem that failed half-way) takes no second seat.
  let reason = null;
  const invite = await changeInvite(code, (current) => {
    reason = null;
    if (current.revoked) { reason = "invite_revoked"; return undefined; }
    if ((current.redeemedBy || []).some((entry) => entry.userId === userId && !entry.deletedAt)) return undefined;
    if (current.seatsUsed >= current.seats) { reason = "invite_full"; return undefined; }
    return {
      ...current,
      seatsUsed: current.seatsUsed + 1,
      redeemedBy: (current.redeemedBy || []).concat({ userId, email: email || null, at: startedAt }),
    };
  });
  // Deliberately the same answer for "never existed" and "wrong": a code
  // checker should not be able to tell one from the other.
  if (!invite) return { ok: false, reason: "invite_invalid" };
  if (reason) return { ok: false, reason };

  const access = {
    userId,
    email: email || null,
    code: invite.code,
    company: invite.company,
    tenantId: workspaceFor(invite.company, userId),
    role: "analyst",
    // The clock starts now, not when the link was made.
    trialStartedAt: startedAt,
    trialEndsAt: new Date(now + invite.days * 24 * 60 * 60 * 1000).toISOString(),
  };

  // The trial ENDS in days; the record is KEPT for years. Two different clocks,
  // and confusing them is how a prospect's work gets thrown away at the end of
  // an evaluation. See lib/uboRetention.js.
  const stamped = retention.withRetention(access, new Date(now));

  // Written only if absent: of two requests at once, the first one's clock
  // stands. ponytail: one person racing two DIFFERENT codes keeps the seat
  // taken on the losing invite; the UI cannot do that, so it is not undone.
  const stored = await _deps.storage.update(trialKey(userId), (current) => (current ? undefined : stamped));
  if (!sameCode(stored.code, invite.code)) return { ok: false, reason: "already_in_trial" };
  await _deps.storage.set(workspaceKey(stored.tenantId), userId);

  // The access list is the one place that answers "what may this person see".
  await _deps.userAccess.grantAccess({
    userId,
    tenantId: stored.tenantId,
    role: "analyst",
    email: stored.email,
    addedBy: `invite:${invite.code}`,
  });

  return stored.trialStartedAt === startedAt ? { ok: true, access: stored } : { ok: true, access: stored, alreadyRedeemed: true };
}

/** Revokes the link. People already inside keep working: revoking a link that
 *  reached the wrong inbox should not evict a prospect mid-evaluation. */
async function revokeInvite(code) {
  const at = new Date(_deps.now()).toISOString();
  return Boolean(await changeInvite(code, (invite) => ({ ...invite, revoked: true, revokedAt: at })));
}

/** Changes a trial's paid AI steps after the link has gone out. What was spent
 *  stays spent; raising it lets a used-up trial carry on. Owner only - the
 *  route checks. */
async function setBudget(code, budget) {
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_BUDGET) {
    throw Object.assign(new Error("A budget is a whole number from 1 to 10,000."), { code: "budget_invalid" });
  }
  return changeInvite(code, (invite) => ({ ...invite, budget }));
}

/** Marks (or unmarks) the trial behind a code as a paying customer.
 *
 *  This is what separates a buyer from a non-buyer: a non-buyer's workspaces are
 *  deleted 90 days after the trial ends (owner decision, 2026-09-30); a
 *  customer's are kept under the seven-year rule in lib/uboRetention.js. Kept
 *  with who and when, because it decides whether data survives.
 *
 *  The mark is on THIS code only. It used to cover every code whose company
 *  name matched, so an unrelated prospect who typed the same company name was
 *  spared deletion too (review, 2026-10-09). A second code for the same buyer
 *  is marked on its own. */
async function markCustomer(code, { customer, by }) {
  const mark = customer ? { markedAt: new Date(_deps.now()).toISOString(), markedBy: by || null } : null;
  return Boolean(await changeInvite(code, (invite) => ({ ...invite, customer: mark })));
}

/** Trials by companies that did not buy, whose data is now due for deletion:
 *  TRIAL_DELETE_AFTER_DAYS after the trial ended (lib/uboRetention.js). */
async function dueForDeletion(now = _deps.now()) {
  const afterMs = retention.TRIAL_DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const due = [];
  for (const code of await listCodes()) {
    const invite = await getInvite(code);
    if (!invite || invite.customer) continue;
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
  await changeInvite(code, (invite) => ({
    ...invite,
    redeemedBy: (invite.redeemedBy || []).map((entry) => (entry.userId === userId ? { ...entry, email: null, deletedAt } : entry)),
  }));
  // The person's trial record, and which trial their workspace belonged to.
  for (const key of [trialKey(userId), workspaceKey(tenantId)]) await _deps.storage.del(key);
}

/** The platform's own owners try and demo the product: their steps are not a
 *  prospect's budget, and a trial's end never locks them out. Configuration
 *  only - it must not depend on storage being up. */
function isOwner(userId) {
  return Boolean(userId) && _deps.userAccess.bootstrapOwners().includes(userId);
}

/** The trial member whose workspace this is, or null for a workspace that is
 *  not a trial's. */
async function memberForWorkspace(tenantId) {
  if (!tenantId) return null;
  const member = await _deps.storage.get(workspaceKey(tenantId));
  if (member || !isTrialWorkspace(tenantId)) return member || null;
  // A trial joined before workspaces were recorded (UBO-48), whose member has
  // not come back through the link since: found from the invites, once, and
  // remembered. Without it their colleagues and customers were never counted.
  // ponytail: a scan of every invite, only for a trial workspace with no
  // record - after a backfill or a deletion; an index if invites number
  // thousands.
  for (const code of await listCodes()) {
    const invite = await getInvite(code);
    for (const entry of (invite && invite.redeemedBy) || []) {
      if (!entry.deletedAt && workspaceFor(invite.company, entry.userId) === tenantId) {
        await _deps.storage.set(workspaceKey(tenantId), entry.userId);
        return entry.userId;
      }
    }
  }
  return null;
}

/** The trial a caller works under: { member, trial } or null.
 *
 *  The WORKSPACE decides, not the person: a colleague added to a trial
 *  workspace through People has no trial record of their own, and was
 *  unmetered with no end date (review, 2026-10-09). A customer is passed
 *  without a userId - their own sign-in belongs to no trial.
 *
 *  `tenantId` undefined means "not known": it is looked up on the access list.
 *  A workspace that is not a trial's costs no storage reads at all. */
async function trialOf(userId, tenantId) {
  if (tenantId !== undefined && tenantId !== null && !isTrialWorkspace(tenantId)) return null;
  if (userId) {
    const own = await _deps.storage.get(trialKey(userId));
    if (own) return { member: userId, trial: own };
  }
  let workspace = tenantId;
  if (workspace === undefined && userId) {
    const access = await _deps.userAccess.getAccess(userId);
    workspace = access && access.tenantId;
  }
  if (!isTrialWorkspace(workspace)) return null;
  const member = await memberForWorkspace(workspace);
  if (!member) return null;
  const trial = await _deps.storage.get(trialKey(member));
  return trial ? { member, trial } : null;
}

/** Whose trial pays for this caller's step. */
function trialForActor(actor) {
  if (actor?.kind === "staff") return trialOf(actor.userId || null, actor.tenantId === undefined ? undefined : actor.tenantId || null);
  if (actor?.kind === "customer") return actor.tenantId ? trialOf(null, actor.tenantId) : null;
  return null;
}

async function recordSpend(userId, units = 1) {
  if (isOwner(userId)) return null;
  const found = await trialOf(userId);
  if (!found) return null;
  return _deps.storage.incr(spendKey(found.trial.code), units);
}

/** One paid AI step for a trial, counted where the paid call actually starts
 *  (UBO-44): a request refused for sign-in or workspace, or answered from the
 *  cache, spends nothing and must not use up a step. Spend control, not access
 *  control: a storage failure is logged, never fatal. */
async function countPaidStep(actor) {
  try {
    if (actor?.kind === "staff" && isOwner(actor.userId)) return null;
    const found = await trialForActor(actor);
    if (!found) return null;
    return await _deps.storage.incr(spendKey(found.trial.code), 1);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[ubo-trials] could not count a paid step:", err && err.message);
    return null;
  }
}

/** Before a paid step (lib/rateLimit.js). Refuses an ended or used-up trial.
 *  With `take`, the step is taken from the budget here, atomically, and
 *  checked AFTER taking it: a burst of requests can never spend more than the
 *  budget, as checking first and counting later allowed. A refused step is
 *  given back; `giveBack` returns a taken one if the request is refused later.
 *  Owners and callers in no trial are never refused. Throws on a storage
 *  failure - the caller decides what that means.
 *  @returns {Promise<{refused: null|"trial_ended"|"trial_budget_spent", budget?: number, giveBack?: function}>} */
async function admitPaidStep({ userId = null, tenantId = null, take = false }) {
  if (isOwner(userId)) return { refused: null };
  const found = await trialOf(userId, tenantId);
  if (!found) return { refused: null };
  const { trial } = found;
  if (_deps.now() >= Date.parse(trial.trialEndsAt)) return { refused: "trial_ended" };
  const invite = await getInvite(trial.code);
  const budget = invite ? invite.budget : DEFAULT_BUDGET;
  const key = spendKey(trial.code);
  if (!take) {
    const spent = Number(await _deps.storage.get(key)) || 0;
    return { refused: spent >= budget ? "trial_budget_spent" : null, budget };
  }
  const spent = await _deps.storage.incr(key, 1);
  if (spent > budget) {
    await _deps.storage.incr(key, -1);
    return { refused: "trial_budget_spent", budget };
  }
  return { refused: null, budget, giveBack: () => _deps.storage.incr(key, -1) };
}

/** Whether a staff member's writes must be refused because the trial their
 *  workspace belongs to has ended. Expiry freezes the work: it stays readable,
 *  and nothing new is made in it. Owners never; customers are not asked here
 *  (api/ubo-poc-case.js says why). Throws on a storage failure. */
async function trialEndedFor(actor) {
  if (actor?.kind !== "staff" || isOwner(actor.userId)) return false;
  const found = await trialForActor(actor);
  return Boolean(found) && _deps.now() >= Date.parse(found.trial.trialEndsAt);
}

/** Everything a route or screen needs to decide what this person may do.
 *  `tenantId` as for trialOf: leave it out to look it up. */
async function statusFor(userId, tenantId) {
  const found = await trialOf(userId, tenantId);
  if (!found) return { inTrial: false };
  const { trial } = found;

  const invite = await getInvite(trial.code);
  const budget = invite ? invite.budget : DEFAULT_BUDGET;
  const budgetSpent = Number(await _deps.storage.get(spendKey(trial.code))) || 0;
  if (isOwner(userId)) {
    return {
      inTrial: true, unmetered: true, company: trial.company, tenantId: trial.tenantId, email: trial.email,
      trialEndsAt: trial.trialEndsAt, expired: false, readOnly: false, budget, budgetSpent: 0, budgetLeft: budget, overBudget: false,
    };
  }
  const expired = _deps.now() >= Date.parse(trial.trialEndsAt);
  const overBudget = budgetSpent >= budget;

  return {
    inTrial: true,
    company: trial.company,
    tenantId: trial.tenantId,
    // The trial member's own address, shown only to them - not to a colleague.
    email: found.member === userId ? trial.email : null,
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
  admitPaidStep,
  trialEndedFor,
  memberForWorkspace,
  isTrialWorkspace,
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
