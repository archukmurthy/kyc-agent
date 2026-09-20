"use strict";

const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const REGISTRY_CAPABILITY_PROFILE_V1 = "ubo-registry-capability-profile-v1";
const REGISTRY_CAPABILITY_ENTRY_V1 = "ubo-registry-capability-entry-v1";
const PROFILE_GOVERNANCE_STATE = "REVIEW_ONLY";
const PROFILE_REQUIRED_SIGNOFF = "A-15";
const ANY = "ANY";

const CAPABILITY_STATE = Object.freeze({
  SUPPORTED: "SUPPORTED",
  PARTIAL: "PARTIAL",
  UNSUPPORTED: "UNSUPPORTED",
  RESTRICTED: "RESTRICTED",
  UNKNOWN: "UNKNOWN",
});
const ENTITLEMENT_STATE = Object.freeze({
  ENTITLED: "ENTITLED",
  NOT_ENTITLED: "NOT_ENTITLED",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});
const OUTPUT_CHARACTERISTIC = Object.freeze({
  EXACT: "EXACT",
  RANGE_ONLY: "RANGE_ONLY",
  IDENTITY_ONLY: "IDENTITY_ONLY",
  DOCUMENT_AVAILABLE: "DOCUMENT_AVAILABLE",
  POSITIVE_ASSERTIONS_ONLY: "POSITIVE_ASSERTIONS_ONLY",
  NON_EXHAUSTIVE: "NON_EXHAUSTIVE",
  UNKNOWN: "UNKNOWN",
});
const PROFILE_FRESHNESS_STATE = Object.freeze({
  CURRENT: "CURRENT",
  STALE: "STALE",
  NOT_YET_EFFECTIVE: "NOT_YET_EFFECTIVE",
});
const MATCH_STATE = Object.freeze({ MATCHED: "MATCHED", NO_MATCH: "NO_MATCH" });
const MATCH_DIMENSIONS = Object.freeze([
  "jurisdiction",
  "entityProfile",
  "informationConcept",
  "relationshipDimension",
  "relationshipBasis",
  "acquisitionChannel",
  "entitlementContext",
]);
const SECRET_KEY = /(credential|password|secret|api.?key|access.?token|refresh.?token|bearer|private.?key|url)/i;

function unique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}
function canonicalCode(value, path, { allowAny = true } = {}) {
  assertNonEmptyString(value, path);
  if (!/^[A-Z0-9_.*-]+$/.test(value)) fail(`${path} must be an exact canonical code`);
  if (!allowAny && value === ANY) fail(`${path} must not be ANY`);
  return value;
}
function timestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO timestamp`);
  return value;
}
function rejectSecrets(value, path = "registryCapabilityProfile") {
  if (typeof value === "string" && /^https?:\/\//i.test(value) && /[?&](?:token|key|secret|signature|credential)=/i.test(value)) fail(`${path} must not contain a secret-bearing URL`);
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (SECRET_KEY.test(key)) fail(`${path} must not contain credentials, secrets or URLs`);
    rejectSecrets(item, `${path}.${key}`);
  });
}
function normalizeScope(scope, path) {
  assertAllowedKeys(scope, ["jurisdiction", "entityProfile"], path);
  return {
    jurisdiction: canonicalCode(scope.jurisdiction, `${path}.jurisdiction`),
    entityProfile: canonicalCode(scope.entityProfile, `${path}.entityProfile`),
  };
}
function normalizeEntry(entry, index) {
  const path = `capabilityEntries[${index}]`;
  assertAllowedKeys(entry, [
    "contractVersion", "entryId", "jurisdiction", "entityProfile", "informationConcept",
    "relationshipDimension", "relationshipBasis", "acquisitionChannel", "entitlementContext",
    "capabilityState", "entitlementState", "outputCharacteristics", "sourceDecisionReferences",
    "governanceState", "productionAuthorized", "requiredSignoffs", "displayMetadata",
  ], path);
  if (entry.contractVersion !== undefined && entry.contractVersion !== REGISTRY_CAPABILITY_ENTRY_V1) fail(`${path}.contractVersion is invalid`);
  const dimensions = Object.fromEntries(MATCH_DIMENSIONS.map((field) => [field, canonicalCode(entry[field] || ANY, `${path}.${field}`)]));
  assertEnum(entry.capabilityState, CAPABILITY_STATE, `${path}.capabilityState`);
  assertEnum(entry.entitlementState, ENTITLEMENT_STATE, `${path}.entitlementState`);
  assertArray(entry.outputCharacteristics || [], `${path}.outputCharacteristics`);
  const outputCharacteristics = unique(entry.outputCharacteristics || []);
  outputCharacteristics.forEach((item) => assertEnum(item, OUTPUT_CHARACTERISTIC, `${path}.outputCharacteristics`));
  const semantic = {
    contractVersion: REGISTRY_CAPABILITY_ENTRY_V1,
    ...dimensions,
    capabilityState: entry.capabilityState,
    entitlementState: entry.entitlementState,
    outputCharacteristics,
    sourceDecisionReferences: unique(entry.sourceDecisionReferences),
    governanceState: PROFILE_GOVERNANCE_STATE,
    productionAuthorized: false,
    requiredSignoffs: unique([PROFILE_REQUIRED_SIGNOFF, ...(entry.requiredSignoffs || [])]),
  };
  const entryHash = hashArtifact(semantic);
  const expectedId = `${REGISTRY_CAPABILITY_ENTRY_V1}:${entryHash.slice(7, 39)}`;
  if (entry.entryId !== undefined && entry.entryId !== expectedId) fail(`${path}.entryId does not match its semantic content`);
  if (entry.governanceState !== undefined && entry.governanceState !== PROFILE_GOVERNANCE_STATE) fail(`${path}.governanceState must be REVIEW_ONLY`);
  if (entry.productionAuthorized !== undefined && entry.productionAuthorized !== false) fail(`${path}.productionAuthorized must be false`);
  if (entry.displayMetadata !== undefined) assertDataOnly(entry.displayMetadata, `${path}.displayMetadata`);
  return { ...semantic, entryId: expectedId, ...(entry.displayMetadata === undefined ? {} : { displayMetadata: cloneData(entry.displayMetadata) }) };
}
function entrySemantic(entry) {
  const { entryId, displayMetadata, ...semantic } = entry;
  return semantic;
}
function profileSemantic(profile) {
  return {
    contractVersion: profile.contractVersion,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    governanceState: profile.governanceState,
    assertedByReference: profile.assertedByReference,
    effectivePeriod: profile.effectivePeriod,
    lastReviewedDate: profile.lastReviewedDate,
    reviewByDate: profile.reviewByDate,
    entitlementContext: profile.entitlementContext,
    supportedScopes: profile.supportedScopes,
    capabilityEntries: profile.capabilityEntries.map(entrySemantic),
    sourceDecisionReferences: profile.sourceDecisionReferences,
    productionAuthorized: profile.productionAuthorized,
    requiredSignoffs: profile.requiredSignoffs,
  };
}

function createRegistryCapabilityProfileV1(input) {
  assertAllowedKeys(input, [
    "contractVersion", "profileId", "profileVersion", "profileHash", "governanceState",
    "assertedByReference", "effectivePeriod", "lastReviewedDate", "reviewByDate", "entitlementContext",
    "supportedScopes", "capabilityEntries", "sourceDecisionReferences", "productionAuthorized",
    "requiredSignoffs", "displayMetadata",
  ], "registryCapabilityProfile");
  assertDataOnly(input, "registryCapabilityProfile");
  rejectSecrets(input);
  if (input.contractVersion !== undefined && input.contractVersion !== REGISTRY_CAPABILITY_PROFILE_V1) fail("registryCapabilityProfile.contractVersion is invalid");
  assertNonEmptyString(input.profileId, "registryCapabilityProfile.profileId");
  assertNonEmptyString(input.profileVersion, "registryCapabilityProfile.profileVersion");
  assertNonEmptyString(input.assertedByReference, "registryCapabilityProfile.assertedByReference");
  assertPlainObject(input.effectivePeriod, "registryCapabilityProfile.effectivePeriod");
  assertAllowedKeys(input.effectivePeriod, ["from", "to"], "registryCapabilityProfile.effectivePeriod");
  const effectivePeriod = { from: timestamp(input.effectivePeriod.from, "effectivePeriod.from"), to: timestamp(input.effectivePeriod.to, "effectivePeriod.to") };
  if (Date.parse(effectivePeriod.from) > Date.parse(effectivePeriod.to)) fail("effectivePeriod.from must not be after effectivePeriod.to");
  timestamp(input.lastReviewedDate, "registryCapabilityProfile.lastReviewedDate");
  timestamp(input.reviewByDate, "registryCapabilityProfile.reviewByDate");
  assertPlainObject(input.entitlementContext, "registryCapabilityProfile.entitlementContext");
  assertAllowedKeys(input.entitlementContext, ["contextId", "state"], "registryCapabilityProfile.entitlementContext");
  canonicalCode(input.entitlementContext.contextId, "registryCapabilityProfile.entitlementContext.contextId", { allowAny: false });
  assertEnum(input.entitlementContext.state, ENTITLEMENT_STATE, "registryCapabilityProfile.entitlementContext.state");
  assertArray(input.supportedScopes, "registryCapabilityProfile.supportedScopes");
  assertArray(input.capabilityEntries, "registryCapabilityProfile.capabilityEntries");
  if (input.capabilityEntries.length === 0) fail("registryCapabilityProfile.capabilityEntries must not be empty");
  const entries = input.capabilityEntries.map(normalizeEntry).sort((a, b) => a.entryId.localeCompare(b.entryId));
  if (new Set(entries.map(({ entryId }) => entryId)).size !== entries.length) fail("registryCapabilityProfile contains duplicate capability entries");
  const profile = {
    contractVersion: REGISTRY_CAPABILITY_PROFILE_V1,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    governanceState: PROFILE_GOVERNANCE_STATE,
    assertedByReference: input.assertedByReference,
    effectivePeriod,
    lastReviewedDate: timestamp(input.lastReviewedDate, "registryCapabilityProfile.lastReviewedDate"),
    reviewByDate: timestamp(input.reviewByDate, "registryCapabilityProfile.reviewByDate"),
    entitlementContext: cloneData(input.entitlementContext),
    supportedScopes: input.supportedScopes.map(normalizeScope).sort((a, b) => `${a.jurisdiction}|${a.entityProfile}`.localeCompare(`${b.jurisdiction}|${b.entityProfile}`)),
    capabilityEntries: entries,
    sourceDecisionReferences: unique(input.sourceDecisionReferences),
    productionAuthorized: false,
    requiredSignoffs: unique([PROFILE_REQUIRED_SIGNOFF, ...(input.requiredSignoffs || [])]),
    ...(input.displayMetadata === undefined ? {} : { displayMetadata: cloneData(input.displayMetadata) }),
  };
  if (input.governanceState !== undefined && input.governanceState !== PROFILE_GOVERNANCE_STATE) fail("registryCapabilityProfile.governanceState must be REVIEW_ONLY");
  if (input.productionAuthorized !== undefined && input.productionAuthorized !== false) fail("registryCapabilityProfile.productionAuthorized must be false");
  const profileHash = hashArtifact(profileSemantic(profile));
  if (input.profileHash !== undefined && input.profileHash !== profileHash) fail("registryCapabilityProfile.profileHash mismatch");
  return deepFreeze(cloneData({ ...profile, profileHash }));
}

function validateRegistryCapabilityProfileV1(profile) {
  const recreated = createRegistryCapabilityProfileV1(profile);
  if (recreated.profileHash !== profile.profileHash) fail("registryCapabilityProfile hash mismatch");
  return true;
}

function evaluateProfileFreshness(profile, evaluationTime) {
  validateRegistryCapabilityProfileV1(profile);
  const at = Date.parse(timestamp(evaluationTime, "evaluationTime"));
  if (at < Date.parse(profile.effectivePeriod.from)) return PROFILE_FRESHNESS_STATE.NOT_YET_EFFECTIVE;
  if (at > Date.parse(profile.effectivePeriod.to) || at > Date.parse(profile.reviewByDate)) return PROFILE_FRESHNESS_STATE.STALE;
  return PROFILE_FRESHNESS_STATE.CURRENT;
}

function matchRegistryCapabilityEntry(profile, query, evaluationTime) {
  validateRegistryCapabilityProfileV1(profile);
  assertAllowedKeys(query, MATCH_DIMENSIONS, "capabilityQuery");
  const normalized = Object.fromEntries(MATCH_DIMENSIONS.map((field) => [field, canonicalCode(query[field] || ANY, `capabilityQuery.${field}`)]));
  const freshnessState = evaluateProfileFreshness(profile, evaluationTime);
  const scopeSupported = profile.supportedScopes.some((scope) => (
    (scope.jurisdiction === ANY || scope.jurisdiction === normalized.jurisdiction)
    && (scope.entityProfile === ANY || scope.entityProfile === normalized.entityProfile)
  ));
  if (!scopeSupported) return deepFreeze({ matchState: MATCH_STATE.NO_MATCH, freshnessState, query: cloneData(normalized), entry: null, specificity: null });
  const matches = profile.capabilityEntries.map((entry) => ({
    entry,
    specificity: MATCH_DIMENSIONS.reduce((score, field) => score + (entry[field] === normalized[field] && entry[field] !== ANY ? 1 : 0), 0),
    matches: MATCH_DIMENSIONS.every((field) => entry[field] === ANY || entry[field] === normalized[field]),
  })).filter(({ matches }) => matches).sort((a, b) => b.specificity - a.specificity || a.entry.entryId.localeCompare(b.entry.entryId));
  if (matches.length === 0) return deepFreeze({ matchState: MATCH_STATE.NO_MATCH, freshnessState, query: cloneData(normalized), entry: null, specificity: null });
  const highest = matches[0].specificity;
  const winners = matches.filter(({ specificity }) => specificity === highest);
  if (winners.length > 1) fail(`ambiguous RegistryCapabilityProfile entries at specificity ${highest}`);
  return deepFreeze(cloneData({ matchState: MATCH_STATE.MATCHED, freshnessState, query: normalized, entry: winners[0].entry, specificity: highest }));
}

module.exports = {
  ANY,
  CAPABILITY_STATE,
  ENTITLEMENT_STATE,
  MATCH_STATE,
  OUTPUT_CHARACTERISTIC,
  PROFILE_FRESHNESS_STATE,
  REGISTRY_CAPABILITY_ENTRY_V1,
  REGISTRY_CAPABILITY_PROFILE_V1,
  createRegistryCapabilityProfileV1,
  evaluateProfileFreshness,
  matchRegistryCapabilityEntry,
  validateRegistryCapabilityProfileV1,
};
