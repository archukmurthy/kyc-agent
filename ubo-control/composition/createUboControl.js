"use strict";

const {
  UBO_CONFIGURATION_ERROR_CODE,
  UboConfigurationError,
} = require("../errors");
const {
  isDiscoveryService,
  isExtractionService,
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateExtractionRequest,
} = require("../contracts/capability");
const { loadPolicyPack } = require("../policy/policyPack");

function configurationError(code, message, cause) {
  return new UboConfigurationError(message, { code, cause });
}

function loadConfiguredPolicyPack(policyPack) {
  try {
    if (policyPack && policyPack.policyPack && policyPack.identity) {
      return loadPolicyPack(policyPack.policyPack, { expectedHash: policyPack.identity.hash });
    }
    return loadPolicyPack(policyPack);
  } catch (cause) {
    throw configurationError(
      UBO_CONFIGURATION_ERROR_CODE.INVALID_POLICY_PACK,
      "A valid, pinned Policy Pack is required",
      cause,
    );
  }
}

function createUboControl({ discoveryService, extractionService, policyPack } = {}) {
  if (discoveryService === undefined || discoveryService === null) {
    throw configurationError(
      UBO_CONFIGURATION_ERROR_CODE.MISSING_DISCOVERY_SERVICE,
      "DiscoveryService must be explicitly configured",
    );
  }
  if (!isDiscoveryService(discoveryService)) {
    throw configurationError(
      UBO_CONFIGURATION_ERROR_CODE.INVALID_DISCOVERY_SERVICE,
      "DiscoveryService must provide discover(request)",
    );
  }

  if (extractionService === undefined || extractionService === null) {
    throw configurationError(
      UBO_CONFIGURATION_ERROR_CODE.MISSING_EXTRACTION_SERVICE,
      "ExtractionService must be explicitly configured",
    );
  }
  if (!isExtractionService(extractionService)) {
    throw configurationError(
      UBO_CONFIGURATION_ERROR_CODE.INVALID_EXTRACTION_SERVICE,
      "ExtractionService must provide extract(request)",
    );
  }

  const loadedPolicyPack = loadConfiguredPolicyPack(policyPack);

  return Object.freeze({
    policyIdentity: loadedPolicyPack.identity,

    async discover(request) {
      validateDiscoveryRequest(request);
      const result = await discoveryService.discover(request);
      validateCapabilityResult(result, { expectedRequestId: request.requestId });
      return result;
    },

    async extract(request) {
      validateExtractionRequest(request);
      const result = await extractionService.extract(request);
      validateCapabilityResult(result, { expectedRequestId: request.requestId });
      return result;
    },
  });
}

module.exports = { createUboControl };
