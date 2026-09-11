"use strict";

// Screening provider registry. One entry today; a second provider (Refinitiv,
// Onfido, sanctions.io) is added here + a new adapter — nothing else changes.
const { ComplyCubeScreeningAdapter } = require("./providers/complyCubeScreeningAdapter");
const { screeningConfig } = require("./config");

const REGISTRY = { complycube: () => new ComplyCubeScreeningAdapter() };

function getScreeningProvider(name = screeningConfig().provider) {
  const key = String(name).toLowerCase();
  const make = REGISTRY[key];
  if (!make) throw new Error(`Unsupported screening provider: ${name}`);
  return make();
}

module.exports = { getScreeningProvider };
