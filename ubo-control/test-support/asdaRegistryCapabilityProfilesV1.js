"use strict";

const {
  CAPABILITY_STATE,
  ENTITLEMENT_STATE,
  OUTPUT_CHARACTERISTIC,
  createRegistryCapabilityProfileV1,
} = require("../planning/registryCapabilityProfileV1");

function createAsdaReviewProfile({ profileId, profileVersion, capabilityState, outputCharacteristics }) {
  return createRegistryCapabilityProfileV1({
    profileId,
    profileVersion,
    assertedByReference: "SANITIZED_ASDA_WAVE_9_CHARACTERIZATION",
    effectivePeriod: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.999Z" },
    lastReviewedDate: "2026-09-06T00:00:00.000Z",
    reviewByDate: "2026-12-31T23:59:59.999Z",
    entitlementContext: { contextId: "ASDA_REVIEW", state: ENTITLEMENT_STATE.ENTITLED },
    supportedScopes: [{ jurisdiction: "GB", entityProfile: "COMPANY" }],
    capabilityEntries: [{
      jurisdiction: "ANY",
      entityProfile: "ANY",
      informationConcept: "ANY",
      relationshipDimension: "ANY",
      relationshipBasis: "ANY",
      acquisitionChannel: "REGISTRY_DISCOVERY",
      entitlementContext: "ASDA_REVIEW",
      capabilityState,
      entitlementState: ENTITLEMENT_STATE.ENTITLED,
      outputCharacteristics,
      sourceDecisionReferences: ["SANITIZED_ASDA_WAVE_9_CHARACTERIZATION"],
    }],
    sourceDecisionReferences: ["A-15", "SANITIZED_ASDA_WAVE_9_CHARACTERIZATION"],
  });
}

function createAsdaFurtherCoverageProfile() {
  return createAsdaReviewProfile({
    profileId: "asda-wave-9-further-coverage",
    profileVersion: "1",
    capabilityState: CAPABILITY_STATE.PARTIAL,
    outputCharacteristics: [OUTPUT_CHARACTERISTIC.POSITIVE_ASSERTIONS_ONLY, OUTPUT_CHARACTERISTIC.NON_EXHAUSTIVE],
  });
}

function createAsdaPredictableOpacityProfile() {
  return createAsdaReviewProfile({
    profileId: "asda-wave-9-predictable-opacity",
    profileVersion: "1",
    capabilityState: CAPABILITY_STATE.UNSUPPORTED,
    outputCharacteristics: [OUTPUT_CHARACTERISTIC.UNKNOWN],
  });
}

module.exports = { createAsdaFurtherCoverageProfile, createAsdaPredictableOpacityProfile };
