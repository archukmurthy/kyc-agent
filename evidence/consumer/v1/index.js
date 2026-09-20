"use strict";

const { CONSUMER_CONTRACT_VERSION, CONTRACT_VERSIONS, OPERATION_NAMES } = require("./contracts");
const { PUBLIC_ERRORS } = require("./errors");
const { createEvidenceConsumer } = require("./facade");

const ERROR_CODES = Object.freeze([...new Set([...Object.values(PUBLIC_ERRORS).map(([code]) => code), "operation_failed"])]);

module.exports = Object.freeze({
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  ERROR_CODES,
  OPERATION_NAMES,
  createEvidenceConsumer,
});
