"use strict";

// Provider-neutral screening result. Adapters normalize their provider's raw
// interpretation into THIS shape so the store + band logic never see provider
// field names. The observation vocabulary is the same neutral set persisted in
// idv_screening_checks.categories, so there is no translation at the DB boundary.
const OBSERVATION_KEYS = Object.freeze(["watchlist", "pep", "adverseMedia", "other"]);

function normalizeScreening(interpreted = {}) {
  const cats = interpreted.categories || {};
  const observations = {};
  for (const k of OBSERVATION_KEYS) observations[k] = !!cats[k];
  return {
    status: interpreted.status || "unknown",
    outcome: interpreted.outcome || null,
    hit: interpreted.outcome === "attention",
    notProcessed: interpreted.outcome === "not_processed",
    observations,
    matchCount: interpreted.matchCount || 0,
  };
}

module.exports = { OBSERVATION_KEYS, normalizeScreening };
