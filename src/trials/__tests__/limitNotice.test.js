/**
 * Telling somebody they have reached a limit, rather than that we broke.
 *
 * The case that matters most is the ended trial: somebody who wants more is
 * telling us they are interested, and until today that arrived as
 * "trial_ended: ..." under a heading saying we could not complete the research.
 */
import { isRetryable, limitNotice, LIMIT_CODES } from "../limitNotice";

test("an ended trial is a sales moment, not an error", () => {
  const notice = limitNotice("trial_ended", "This trial has ended. Your work is still here and can be viewed - get in touch to continue.");
  expect(notice.title).toBe("Your trial has ended");
  expect(notice.body).toMatch(/work is still here/);
  expect(notice.action).toBe("contact");
  expect(isRetryable("trial_ended")).toBe(false);
});

test("a spent budget says what happens next, not what went wrong", () => {
  const notice = limitNotice("trial_budget_spent", "This trial has used all 100 paid AI steps.");
  expect(notice.title).toMatch(/paid AI steps/i);
  expect(notice.body).toMatch(/100/);
  expect(notice.action).toBe("contact");
  expect(isRetryable("trial_budget_spent")).toBe(false);
});

test("a limit that lifts by itself offers waiting, not getting in touch", () => {
  expect(limitNotice("rate_limited", "Try again in 12 minutes.").action).toBe("wait");
  expect(limitNotice("spend_cap_reached", "Resets at midnight UTC.").action).toBe("wait");
  expect(isRetryable("rate_limited")).toBe(true);
  expect(isRetryable("spend_cap_reached")).toBe(true);
});

test("the server's own sentence is used, because it has the numbers", () => {
  // The heading is ours; the figures are the server's. Two places writing the
  // same number is two places to get it wrong.
  const notice = limitNotice("rate_limited", "You have used all 15 requests for this hour. Try again in 12 minutes.");
  expect(notice.body).toBe("You have used all 15 requests for this hour. Try again in 12 minutes.");
});

test("a sentence we did not get still reads like English", () => {
  for (const code of LIMIT_CODES) {
    const notice = limitNotice(code, "");
    expect(notice.body.length).toBeGreaterThan(20);
    expect(notice.body).not.toMatch(/undefined|null/);
  }
});

test("a genuine failure is not dressed up as a limit", () => {
  // A real break must keep saying so - "please wait" over a crash is worse
  // than the crash.
  expect(limitNotice("provider_timeout", "The provider did not respond.")).toBeNull();
  expect(limitNotice(null, "Something went wrong")).toBeNull();
  expect(limitNotice(undefined, undefined)).toBeNull();
  expect(isRetryable("provider_timeout")).toBe(true);
});
