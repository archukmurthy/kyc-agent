/* eslint-env node */
"use strict";

/**
 * Calling a paid provider with a deadline.
 *
 * Five call sites reach api.anthropic.com and none of them set a timeout. A
 * provider that accepts the connection and then goes quiet holds a serverless
 * function open until the platform kills it: we pay for the wall-clock, the
 * caller gets nothing back, and a retry stacks another one on top.
 *
 * This is a thin wrapper, not a client. It adds three things and nothing else:
 *   - a deadline, enforced with AbortController
 *   - a clear failure (provider_timeout, HTTP 504) rather than a hang
 *   - the caller's own abort signal still works, so a request nobody is
 *     waiting for can be stopped early
 *
 * CommonJS so api/ handlers, agents/ and the lab server can all require it.
 */

// Research with web search legitimately takes tens of seconds; minutes means
// something is wrong and the platform will kill the function regardless.
const DEFAULT_TIMEOUT_MS = 60_000;

let _deps = { now: () => Date.now() };

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ timeoutMs?: number, fetchImpl?: Function }} [config]
 */
async function fetchWithTimeout(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = global.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new Error(`Provider call timed out after ${timeoutMs}ms`);
    reason.code = "provider_timeout";
    reason.status = 504;
    controller.abort(reason);
  }, timeoutMs);

  // Whoever called us may have their own signal - a request the user navigated
  // away from should stop then, not when our deadline expires.
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener("abort", () => controller.abort(options.signal.reason), { once: true });
  }

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    // AbortController surfaces our reason on the signal; some runtimes throw a
    // bare AbortError instead, so check both.
    const reason = controller.signal.reason;
    if (reason && reason.code === "provider_timeout") throw reason;
    if (err && err.name === "AbortError" && !options.signal) {
      const timeout = new Error(`Provider call timed out after ${timeoutMs}ms`);
      timeout.code = "provider_timeout";
      timeout.status = 504;
      throw timeout;
    }
    throw err;
  } finally {
    // Always clear it: a live timer keeps a serverless function alive after the
    // work is finished, which is time we pay for and nobody uses.
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout, DEFAULT_TIMEOUT_MS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
