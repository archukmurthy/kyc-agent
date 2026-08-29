"use strict";

const {
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateExtractionRequest,
} = require("../contracts/capability");
const { assertArray, cloneData, deepFreeze } = require("../internal/validation");

function configuredSequence(results, path) {
  assertArray(results, path);
  const copy = cloneData(results);
  copy.forEach((result) => validateCapabilityResult(result));
  return deepFreeze(copy);
}

class StubSequenceExhaustedError extends Error {
  constructor(capability) {
    super(`${capability} stub response sequence is exhausted`);
    this.name = "StubSequenceExhaustedError";
    this.code = "STUB_RESPONSE_SEQUENCE_EXHAUSTED";
  }
}

class StubDiscoveryService {
  #results;
  #nextIndex = 0;

  constructor(results) {
    this.#results = configuredSequence(results, "StubDiscoveryService results");
  }

  async discover(request) {
    validateDiscoveryRequest(request);
    const configured = this.#results[this.#nextIndex];
    if (configured === undefined) throw new StubSequenceExhaustedError("Discovery");
    validateCapabilityResult(configured, { expectedRequestId: request.requestId });
    this.#nextIndex += 1;
    return cloneData(configured);
  }
}

class StubExtractionService {
  #results;
  #nextIndex = 0;

  constructor(results) {
    this.#results = configuredSequence(results, "StubExtractionService results");
  }

  async extract(request) {
    validateExtractionRequest(request);
    const configured = this.#results[this.#nextIndex];
    if (configured === undefined) throw new StubSequenceExhaustedError("Extraction");
    validateCapabilityResult(configured, { expectedRequestId: request.requestId });
    this.#nextIndex += 1;
    return cloneData(configured);
  }
}

module.exports = {
  StubDiscoveryService,
  StubExtractionService,
  StubSequenceExhaustedError,
};
