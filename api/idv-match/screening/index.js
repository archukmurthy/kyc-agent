"use strict";

// Screening orchestration + the single signal the band logic consumes.
const store = require("./store");
const { getScreeningProvider } = require("./registry");
const complyCubeClient = require("./complyCubeClient");
const { interpretCheck } = require("./interpret");

// Start screening for one person on an attempt via the configured provider, and
// store a pending row bound to the attempt. The result normally arrives later via
// webhook (or server reconcile); a synchronously-graded result is recorded now.
async function startScreening(attemptId, person, deps = {}) {
  if (!attemptId) throw new Error("startScreening: attemptId is required");
  const provider = deps.screeningProvider || getScreeningProvider();
  const s = deps.store || store;

  const { providerClientId, providerCheckId, result } = await provider.screenPerson(person, deps);
  const screeningId = await s.createScreening({
    attemptId,
    provider: "complycube",
    complyCubeClientId: providerClientId,
    complyCubeCheckId: providerCheckId,
  });

  if (result && result.outcome) {
    await s.updateScreeningResult(screeningId, {
      status: result.status,
      outcome: result.outcome,
      categories: result.observations,
    });
  }
  return { screeningId, providerCheckId };
}

// Aggregate all screening rows for an attempt (e.g. document name + CH name): a
// hit on ANY is a hit. Pending / not-processed are surfaced so the caller never
// treats an unknown state as clear.
async function hasScreeningHit(attemptId, deps = {}) {
  const s = deps.store || store;
  const rows = await s.listByAttempt(attemptId);

  const categories = { watchlist: false, pep: false, adverseMedia: false, other: false };
  let hit = false;
  let pending = false;
  let notProcessed = false;

  for (const row of rows) {
    if (row.outcome === "attention") {
      hit = true;
      const c = row.categories || {};
      categories.watchlist = categories.watchlist || !!c.watchlist;
      categories.pep = categories.pep || !!c.pep;
      categories.adverseMedia = categories.adverseMedia || !!c.adverseMedia;
      categories.other = categories.other || !!c.other;
    } else if (row.outcome === "not_processed") {
      notProcessed = true;
    }
    if (row.status !== "complete" && row.outcome == null) pending = true;
  }

  return { hit, pending, notProcessed, categories, count: rows.length };
}

// A ComplyCube screening result normally arrives via webhook; locally (and as a
// production fallback with no webhook configured) there's no other way to learn
// the outcome. Re-pull any still-pending check for the attempt and store its
// result, mirroring what webhook.js does per delivery — so a poll of /resolve
// can advance a pending row toward terminal without waiting on a webhook.
async function reconcileScreening(attemptId, deps = {}) {
  const s = deps.store || store;
  const cc = deps.complyCubeClient || complyCubeClient;
  const rows = await s.listByAttempt(attemptId);
  for (const row of rows) {
    const pending = row.status !== "complete" && row.outcome == null && row.complycube_check_id;
    if (!pending) continue;
    try {
      const check = await cc.getCheck(row.complycube_check_id);
      const interpreted = interpretCheck(check);
      if (interpreted.outcome) {
        await s.updateScreeningResult(row.id, { status: interpreted.status, outcome: interpreted.outcome, categories: interpreted.categories });
      }
    } catch (err) {
      console.error("[idv-match screening reconcile] getCheck failed for", row.complycube_check_id, "-", err && err.message);
    }
  }
}

module.exports = { startScreening, hasScreeningHit, reconcileScreening };
