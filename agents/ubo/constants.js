"use strict";

const NODE_TYPES = Object.freeze({
  INDIVIDUAL: "individual",
  COMPANY: "company",
  TRUST: "trust",
  FOUNDATION: "foundation",
  GOVERNMENT: "government",
  PUBLIC_COMPANY: "public_company",
  UNKNOWN: "unknown",
});

const EDGE_TYPES = Object.freeze({
  OWNERSHIP: "ownership",
  CONTROL: "control",
  DIRECTOR: "director_relationship",
  TRUSTEE: "trustee_relationship",
  SETTLOR: "settlor_relationship",
  PROTECTOR: "protector_relationship",
});

const TERMINAL_NODE_TYPES = new Set([
  NODE_TYPES.INDIVIDUAL,
  NODE_TYPES.PUBLIC_COMPANY,
  NODE_TYPES.GOVERNMENT,
  NODE_TYPES.TRUST,
  NODE_TYPES.FOUNDATION,
]);

const DEFAULT_RULES = Object.freeze({
  uboThreshold: 25,
  discoveryThreshold: 5,
  includeControl: true,
  budgets: {
    maxEntitiesToInvestigate: 25,
    maxDocumentsToDownload: 50,
    maxSearchIterations: 30,
  },
});

module.exports = { NODE_TYPES, EDGE_TYPES, TERMINAL_NODE_TYPES, DEFAULT_RULES };
