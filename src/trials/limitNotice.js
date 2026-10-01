/**
 * Telling somebody they have reached a limit, rather than that we broke.
 *
 * Four of these are the server working exactly as intended: a trial has ended,
 * a trial has spent its research budget, an account has reached its daily
 * ceiling, or somebody is going too fast. Every one of them arrived at the
 * screen as "We could not complete this research", with a machine code printed
 * in front of the sentence and a "Try again" button that could only fail again.
 *
 * The end of a trial is the best moment we get: somebody who wants more is
 * telling us they are interested. Showing them a crash wastes it.
 *
 * The server already writes the sentence - it knows the numbers and the dates.
 * This only decides the heading and what the button should offer, so the two
 * never disagree about the figures.
 */

const NOTICES = {
  trial_ended: {
    title: "Your trial has ended",
    action: "contact",
    // Deliberately not "expired": nothing has been taken away. The work is
    // still there, which is the thing worth saying.
    fallback: "This trial has ended. Your work is still here and can be viewed - get in touch to continue.",
  },
  trial_budget_spent: {
    title: "This trial has used all its paid AI steps",
    action: "contact",
    fallback: "This trial has used all its paid AI steps (research runs and document readings). Your work is still here - get in touch to continue.",
  },
  demo_allowance_spent: {
    title: "This demo has used all its runs",
    action: "contact",
    fallback: "This demo has reached its limit. Get in touch to continue.",
  },
  spend_cap_reached: {
    title: "Research is paused for today",
    action: "wait",
    fallback: "Research is paused for today while we review usage. It resets at midnight UTC.",
  },
  rate_limited: {
    title: "That is a lot of research at once",
    action: "wait",
    fallback: "You have made a lot of requests in a short time. Try again shortly.",
  },
};

/**
 * @param {string} code    the server's error code
 * @param {string} message the server's sentence, which carries the real numbers
 * @returns {{title: string, body: string, action: "contact"|"wait"}|null}
 *          null when this is a genuine failure rather than a limit.
 */
export function limitNotice(code, message) {
  const notice = NOTICES[code];
  if (!notice) return null;
  return {
    title: notice.title,
    // The server's own words where we have them: it knows how many minutes are
    // left and when the trial ended. A fallback only for when it says nothing.
    body: (message || "").trim() || notice.fallback,
    action: notice.action,
  };
}

/** Whether trying the same thing again could possibly work. */
export function isRetryable(code) {
  const notice = NOTICES[code];
  if (!notice) return true;
  return notice.action === "wait";
}

export const LIMIT_CODES = Object.keys(NOTICES);
