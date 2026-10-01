"use strict";

// Trial invites: how five people at one company get in without us knowing their
// email addresses in advance, and without a manual step between clicking and
// working.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const trials = require("../uboTrials");

let store;
let clock;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  store = new Map();
  clock = Date.parse("2026-09-20T09:00:00.000Z");
  trials.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
      del: async (k) => { store.delete(k); },
    },
    now: () => clock,
  });
});

test("an invite carries a company, a seat count and a length", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 5, days: 7, createdBy: "user_owner" });
  assert.match(invite.code, /^[A-Z0-9-]{6,}$/, "a code has to survive being read down a phone");
  assert.equal(invite.company, "Acme");
  assert.equal(invite.seats, 5);
  assert.equal(invite.days, 7);
  assert.equal(invite.seatsUsed, 0);
});

test("redeeming gives the person their own space, not a shared one", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 5, days: 7 });
  const a = await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  const b = await trials.redeem({ code: invite.code, userId: "user_b", email: "b@acme.com" });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.access.tenantId, b.access.tenantId, "one prospect must never see another's research");
  assert.ok(a.access.tenantId.includes("acme"), "the workspace is named after the company for our own sanity");
});

test("the email is stored, because the Clerk id will change", async () => {
  // Clerk cannot move accounts between instances, so a move to a real domain
  // gives everyone a new id. The verified email is the stable identity - store
  // it now and their work can be re-linked instead of orphaned.
  const invite = await trials.createInvite({ company: "Acme", seats: 2, days: 7 });
  const result = await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  assert.equal(result.access.email, "a@acme.com");
});

test("the same person redeeming twice does not consume a second seat", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 2, days: 7 });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  const after = await trials.getInvite(invite.code);
  assert.equal(after.seatsUsed, 1, "reloading the page must not cost a seat");
});

test("seat six of five is refused, and says so", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 5, days: 7 });
  for (let i = 0; i < 5; i++) {
    await trials.redeem({ code: invite.code, userId: `user_${i}`, email: `${i}@acme.com` });
  }
  const sixth = await trials.redeem({ code: invite.code, userId: "user_5", email: "5@acme.com" });
  assert.equal(sixth.ok, false);
  assert.equal(sixth.reason, "invite_full");
});

test("the seven days run from first sign-in, not from when the link was made", async () => {
  // A link opened on day five still gives a full week, so a prospect who is
  // slow to look is not handed a two-day trial.
  const invite = await trials.createInvite({ company: "Acme", seats: 1, days: 7 });
  clock += 5 * DAY;
  const result = await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  assert.equal(result.access.trialEndsAt, new Date(clock + 7 * DAY).toISOString());
});

test("an expired trial keeps the work, read-only", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 1, days: 7 });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  clock += 8 * DAY;
  const status = await trials.statusFor("user_a");
  assert.equal(status.expired, true);
  assert.equal(status.readOnly, true, "their cases stay visible - deleting a prospect's work is a bad last impression");
});

test("a revoked invite stops new people but not the ones already in", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 5, days: 7 });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  await trials.revokeInvite(invite.code);

  const late = await trials.redeem({ code: invite.code, userId: "user_b", email: "b@acme.com" });
  assert.equal(late.ok, false);
  assert.equal(late.reason, "invite_revoked");

  const existing = await trials.statusFor("user_a");
  assert.equal(existing.expired, false, "revoking a link must not evict people mid-evaluation");
});

test("an unknown code is refused without saying whether it ever existed", async () => {
  const result = await trials.redeem({ code: "NOPE-1234", userId: "user_a", email: "a@acme.com" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invite_invalid");
});

test("a trial has a spend budget that does not reset", async () => {
  const invite = await trials.createInvite({ company: "Acme", seats: 5, days: 7, budget: 100 });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.com" });
  for (let i = 0; i < 100; i++) await trials.recordSpend("user_a");
  const status = await trials.statusFor("user_a");
  assert.equal(status.budgetSpent, 100);
  assert.equal(status.budgetLeft, 0);
  assert.equal(status.overBudget, true, "an hourly limit resets; the money does not come back");
});

test("a trial marked as a customer says so, with who marked it and when, and can be undone", async () => {
  // Buyers keep everything; a non-buyer's work is deleted 90 days after the
  // trial ends. This mark is the only thing that tells the two apart.
  const invite = await trials.createInvite({ company: "Acme" });
  assert.strictEqual(await trials.markCustomer(invite.code, { customer: true, by: "user_owner" }), true);
  let [listed] = await trials.listInvites();
  assert.strictEqual(listed.customer.markedBy, "user_owner");
  assert.strictEqual(listed.customer.markedAt, new Date(clock).toISOString());
  await trials.markCustomer(invite.code, { customer: false, by: "user_owner" });
  [listed] = await trials.listInvites();
  assert.strictEqual(listed.customer, null);
});

test("marking an unknown code as a customer changes nothing", async () => {
  assert.strictEqual(await trials.markCustomer("NOPE-0000", { customer: true, by: "user_owner" }), false);
});

// Deleting non-buyers' work (owner decision, 2026-09-30): 90 days after the
// trial ends, unless the company was marked as a customer.

test("a non-buyer is due for deletion 90 days after the trial ends, not a day sooner", async () => {
  const invite = await trials.createInvite({ company: "Acme", days: 7 });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.test" });
  clock += (7 + 89) * DAY;
  assert.deepStrictEqual(await trials.dueForDeletion(), []);
  clock += DAY;
  const due = await trials.dueForDeletion();
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].userId, "user_a");
  assert.match(due[0].tenantId, /^trial-acme-/);
});

test("a company marked as a customer is never due for deletion", async () => {
  const invite = await trials.createInvite({ company: "Acme", days: 7 });
  await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.test" });
  await trials.markCustomer(invite.code, { customer: true, by: "user_owner" });
  clock += 400 * DAY;
  assert.deepStrictEqual(await trials.dueForDeletion(), []);
});

test("forgetting a trial removes the person and keeps only a one-line record", async () => {
  const invite = await trials.createInvite({ company: "Acme", days: 7 });
  const { access } = await trials.redeem({ code: invite.code, userId: "user_a", email: "a@acme.test" });
  clock += 97 * DAY;
  const [due] = await trials.dueForDeletion();
  await trials.forgetTrial(due, { deletedAt: new Date(clock).toISOString() });

  assert.strictEqual(await trials.statusFor("user_a").then((s) => s.inTrial), false);
  const [listed] = await trials.listInvites();
  assert.strictEqual(listed.redeemedBy[0].email, null, "the email of a deleted trial is kept nowhere");
  assert.deepStrictEqual(store.get(`ubo-trial-deleted:${access.tenantId}`), { tenantId: access.tenantId, company: "Acme", deletedAt: new Date(clock).toISOString() });
  assert.deepStrictEqual(await trials.dueForDeletion(), [], "a forgotten trial is not due twice");
});

test("a customer mark on any of a company's codes protects every workspace of that company", async () => {
  // A second code for the same company - more seats, a re-sent link - must not
  // leave its people's work to be deleted because only the first was marked.
  const first = await trials.createInvite({ company: "Acme Bank", days: 7 });
  const second = await trials.createInvite({ company: "  acme   bank ", days: 7 });
  await trials.redeem({ code: second.code, userId: "user_b", email: "b@acme.test" });
  await trials.markCustomer(first.code, { customer: true, by: "user_owner" });
  clock += 400 * DAY;
  assert.deepStrictEqual(await trials.dueForDeletion(), []);
});

// One budget of paid AI steps per trial - research runs and document readings
// together - which the owner can change after the link has gone out.
test("the owner can change a trial's paid AI steps after the link has gone out", async () => {
  const invite = await trials.createInvite({ company: "Acme", budget: 1 });
  const updated = await trials.setBudget(invite.code, 3);
  assert.equal(updated.budget, 3);
  assert.equal((await trials.listInvites()).find((item) => item.code === invite.code).budget, 3);
});

test("raising the budget lets a used-up trial carry on", async () => {
  const invite = await trials.createInvite({ company: "Acme", budget: 1 });
  await trials.redeem({ code: invite.code, userId: "user_1", email: "a@example.test" });
  await trials.recordSpend("user_1");
  assert.equal((await trials.statusFor("user_1")).overBudget, true);
  await trials.setBudget(invite.code, 2);
  const status = await trials.statusFor("user_1");
  assert.equal(status.overBudget, false);
  assert.equal(status.budgetLeft, 1, "what was spent stays spent");
});

test("a budget must be a whole number from 1 to 10,000", async () => {
  const invite = await trials.createInvite({ company: "Acme", budget: 5 });
  for (const bad of [0, -1, 1.5, "x", 10001, null]) {
    await assert.rejects(trials.setBudget(invite.code, bad), /whole number/, String(bad));
  }
  assert.equal(await trials.setBudget("NO-SUCH-CODE", 5), null);
});

test("a paid step is the trial's whose workspace it is - staff their own, a customer the inviting trial's - and never fails the request", async () => {
  const invite = await trials.createInvite({ company: "Acme", budget: 5 });
  await trials.redeem({ code: invite.code, userId: "user_1", email: "a@example.test" });
  const { tenantId } = await trials.statusFor("user_1");
  assert.equal(await trials.memberForWorkspace(tenantId), "user_1");
  await trials.countPaidStep({ kind: "staff", userId: "user_1" });
  // The customer's own sign-in is in no trial: the workspace decides (UBO-48).
  await trials.countPaidStep({ kind: "customer", userId: "user_customer", tenantId, caseId: "case-1" });
  await trials.countPaidStep({ kind: "customer", userId: "user_1", tenantId: "trial-other-00000000", caseId: "case-2" });
  await trials.countPaidStep(null);
  assert.equal((await trials.statusFor("user_1")).budgetSpent, 2);
  await trials.forgetTrial({ userId: "user_1", tenantId, code: invite.code, company: "Acme" }, { deletedAt: "2027-01-01T00:00:00.000Z" });
  assert.equal(await trials.memberForWorkspace(tenantId), null);
  trials.__setDeps({ storage: { get: async () => { throw new Error("kv down"); }, set: async () => {}, del: async () => {} } });
  assert.equal(await trials.countPaidStep({ kind: "staff", userId: "user_1" }), null);
});

test("a trial joined before workspaces were recorded gets the record when its member comes back (UBO-48)", async () => {
  const invite = await trials.createInvite({ company: "Acme", budget: 5 });
  await trials.redeem({ code: invite.code, userId: "user_1", email: "a@example.test" });
  const { tenantId } = await trials.statusFor("user_1");
  store.delete(`ubo-trial-workspace:${tenantId}`);
  assert.equal(await trials.memberForWorkspace(tenantId), null);
  const again = await trials.redeem({ code: invite.code, userId: "user_1", email: "a@example.test" });
  assert.equal(again.alreadyRedeemed, true);
  assert.equal(await trials.memberForWorkspace(tenantId), "user_1");
});
