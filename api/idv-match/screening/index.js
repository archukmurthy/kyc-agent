"use strict";

// Screening orchestration + the single signal the band logic consumes.
const complyCubeClient = require("./complyCubeClient");
const store = require("./store");
const { interpretCheck } = require("./interpret");

// Start screening for one person on an attempt: create a ComplyCube client, run
// an extensive screening check, and store a pending row bound to the attempt.
// The result normally arrives later via webhook (or server reconcile); if the
// check already completed synchronously, it is recorded immediately.
async function startScreening(attemptId, person, deps = {}) {
  if (!attemptId) throw new Error("startScreening: attemptId is required");
  const cc = deps.complyCubeClient || complyCubeClient;
  const s = deps.store || store;

  const ccClient = await cc.createClient(person);
  const check = await cc.createScreeningCheck(ccClient.id);
  const screeningId = await s.createScreening({
    attemptId,
    provider: "complycube",
    complyCubeClientId: ccClient.id,
    complyCubeCheckId: check.id,
  });

  const interpreted = interpretCheck(check);
  if (interpreted.outcome) {
    await s.updateScreeningResult(screeningId, {
      status: interpreted.status,
      outcome: interpreted.outcome,
      categories: interpreted.categories,
    });
  }
  return { screeningId, complyCubeCheckId: check.id };
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

module.exports = { startScreening, hasScreeningHit };
