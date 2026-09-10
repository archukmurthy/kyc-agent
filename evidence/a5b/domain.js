"use strict";

const { CANONICALIZATION_VERSION, canonicalize, sha256 } = require("./canonicalize");

const MANIFEST_VERSION = "evidence-package-manifest-v1";
const PURPOSE_CODES = Object.freeze(["internal_review", "regulatory_reconstruction", "investigative_response", "case_evidence_snapshot", "decision_support_snapshot", "other"]);
const MEMBER_TYPES = Object.freeze([
  "evidence_requirement", "evidence_information_need", "evidence_collection_operation", "evidence_acquisition",
  "evidence_asset", "evidence_artifact", "evidence_requirement_asset", "evidence_extraction_run",
  "evidence_extraction_run_artifact", "evidence_extracted_value", "evidence_fact", "evidence_fact_artifact_support",
  "evidence_fact_artifact_locator", "evidence_fact_typed_relationship", "evidence_fact_typed_set_assertion",
  "evidence_fact_derivation", "evidence_verification_attempt", "evidence_interpretation_operation",
  "evidence_need_evaluation_run", "evidence_fact_need_evaluation", "evidence_coverage_assessment_run",
  "evidence_coverage_assessment_candidate", "evidence_coverage_comparison_finding"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_MEMBER_TYPES = new Set([
  "evidence_requirement", "evidence_information_need", "evidence_collection_operation", "evidence_acquisition",
  "evidence_asset", "evidence_artifact", "evidence_extraction_run", "evidence_extracted_value", "evidence_fact",
  "evidence_fact_artifact_locator", "evidence_fact_typed_relationship", "evidence_fact_typed_set_assertion",
  "evidence_verification_attempt", "evidence_interpretation_operation", "evidence_need_evaluation_run",
  "evidence_fact_need_evaluation", "evidence_coverage_assessment_run", "evidence_coverage_assessment_candidate",
  "evidence_coverage_comparison_finding"
]);

function invalid(message, code = "invalid_package_request") { return Object.assign(new Error(message), { code, statusCode: 400 }); }
function required(value, name, max = 200) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw invalid(`${name} is required and must be at most ${max} characters`); return value.trim(); }
function uuid(value, name) { const result = required(value, name, 36).toLowerCase(); if (!UUID.test(result)) throw invalid(`${name} must be a UUID`); return result; }
function instant(value, name) { const parsed = new Date(value); if (!value || Number.isNaN(parsed.getTime())) throw invalid(`${name} must be a valid date/time`); return parsed.toISOString(); }

function validatePurpose(input) {
  const purpose = typeof input === "string" ? { code: input } : input || {};
  const code = required(purpose.code, "purpose.code", 64);
  if (!PURPOSE_CODES.includes(code)) throw invalid("purpose.code is not supported", "unsupported_package_purpose");
  const label = purpose.label == null ? null : required(purpose.label, "purpose.label", 160);
  if (code === "other" && !label) throw invalid("purpose.label is required when purpose.code is other");
  return { code, label };
}

function validateFreezeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Package request is required");
  for (const forbidden of ["members", "memberIds", "entries", "exclusions", "inclusionProfile", "inclusionProfileId", "requirementOrNeedScope"])
    if (Object.prototype.hasOwnProperty.call(input, forbidden)) throw invalid(`${forbidden} is not accepted by A5b v1`, "arbitrary_package_members_not_allowed");
  return {
    tenantId: required(input.tenantId, "tenantId", 100), contextId: uuid(input.contextId, "contextId"),
    subjectReferenceId: uuid(input.subjectReferenceId, "subjectReferenceId"), asOf: instant(input.asOf, "asOf"),
    purpose: validatePurpose(input.purpose), operationKey: required(input.operationKey, "operationKey", 200),
    callerScope: required(input.callerScope, "callerScope", 160), actor: { type: required(input.actor?.type, "actor.type", 80), id: input.actor?.id == null ? null : required(input.actor.id, "actor.id", 200) },
    derivedFromPackageId: input.derivedFromPackageId == null ? null : uuid(input.derivedFromPackageId, "derivedFromPackageId")
  };
}

function requestFingerprint(input, availabilityRulesVersion) {
  return sha256(canonicalize({ tenantId: input.tenantId, contextId: input.contextId, subjectReferenceId: input.subjectReferenceId, asOf: input.asOf, purpose: input.purpose, derivedFromPackageId: input.derivedFromPackageId, callerScope: input.callerScope, availabilityRulesVersion, manifestVersion: MANIFEST_VERSION, canonicalizationVersion: CANONICALIZATION_VERSION }));
}

function memberIdentity(reference) {
  if (!reference || typeof reference !== "object" || !MEMBER_TYPES.includes(reference.type) || typeof reference.id !== "string" || !reference.id.trim()) throw invalid("A5a entry has an unsupported canonical Evidence reference", "invalid_package_member");
  const type = reference.type, rawId = reference.id.trim(), parts = rawId.split(":"), canonicalUuid = (value) => {
    if (!UUID.test(value || "")) throw invalid(`A5a ${type} entry has an invalid canonical key`, "invalid_package_member");
    return value.toLowerCase();
  };
  if (UUID_MEMBER_TYPES.has(type)) {
    const id = canonicalUuid(rawId);
    return { reference: { type, id }, key: { type, id } };
  }
  const layouts = {
    evidence_requirement_asset: ["requirementId", "assetId", "associatedContextId"],
    evidence_extraction_run_artifact: ["extractionRunId", "artifactId", "inputRole"],
    evidence_fact_artifact_support: ["factId", "artifactId"],
    evidence_fact_derivation: ["derivedFactId", "inputFactId", "transformationId"],
  };
  const layout = layouts[type];
  if (!layout || parts.length !== layout.length) throw invalid(`A5a ${type} entry has an invalid composite key`, "invalid_package_member");
  const values = parts.map((part, index) => index < 2 || type === "evidence_requirement_asset" ? canonicalUuid(part) : required(part, `${type}.${layout[index]}`, 200));
  const key = { type }; layout.forEach((name, index) => { key[name] = values[index]; });
  return { reference: { type, id: values.join(":") }, key };
}

function validateMemberReference(reference) {
  return memberIdentity(reference).reference;
}

function authorizationIndex(entries) {
  const artifactToAsset = new Map(), runToAsset = new Map(), factToArtifact = new Map();
  for (const entry of entries) { const type = entry.sourceRecordType, id = entry.evidenceReference?.id, details = entry.details || {}; if (type === "evidence_artifact") artifactToAsset.set(id, details.assetId); if (type === "evidence_extraction_run") runToAsset.set(id, details.assetId); if (type === "evidence_fact") factToArtifact.set(id, details.artifactId); }
  return { artifactToAsset, runToAsset, factToArtifact };
}

function authorizationMetadata(entry, contextId, index) {
  const ref = validateMemberReference(entry.evidenceReference), details = entry.details || {};
  const factId = details.factId || details.derivedFactId || details.targetFactId || details.factAId || (ref.type.includes("typed_") ? ref.id : null);
  const runId = details.extractionRunId || details.verificationExtractionRunId || null;
  const artifactId = details.artifactId || (factId ? index.factToArtifact.get(factId) : null);
  const assetId = ref.type === "evidence_asset" ? ref.id : details.assetId || (artifactId ? index.artifactToAsset.get(artifactId) : null) || (runId ? index.runToAsset.get(runId) : null) || null;
  return assetId ? { kind: "asset", assetIds: [assetId] } : { kind: "context", contextId: entry.contextId || contextId };
}

function buildManifest({ packageId, input, reconstruction, frozenAt }) {
  const entries = reconstruction.entries.map((entry, index) => { const copy=structuredClone(entry),reference=validateMemberReference(copy.evidenceReference);if(copy.sourceRecordType!==reference.type)throw invalid("A5a source record type does not match its canonical reference", "invalid_package_member");return{...copy,evidenceReference:reference,ordinal:index+1}; });
  return {
    manifestVersion: MANIFEST_VERSION, canonicalizationVersion: CANONICALIZATION_VERSION,
    package: { id: packageId, tenantId: input.tenantId, contextId: input.contextId, subjectReferenceId: input.subjectReferenceId, purpose: input.purpose, asOf: input.asOf, frozenAt, actor: input.actor, callerScope: input.callerScope, derivedFromPackageId: input.derivedFromPackageId, availabilityRulesVersion: reconstruction.availabilityRulesVersion },
    context: reconstruction.context, subject: reconstruction.subject, entries, limitations: structuredClone(reconstruction.limitations || []),
    integritySemantics: { manifestSha256: "Protects only the exact canonical Package manifest bytes", artifactSha256: "Separately protects each preserved Artifact's bytes" },
    downstreamDecision: { kyc: "not_performed", ubo: "not_performed" }
  };
}

function buildMembers(manifest) {
  const index = authorizationIndex(manifest.entries);
  return manifest.entries.map((entry) => { const identity = memberIdentity(entry.evidenceReference),ref=identity.reference; return { packageId: manifest.package.id, ordinal: entry.ordinal, memberType: ref.type, canonicalMemberReference: `${ref.type}:${ref.id}`, canonicalMemberKey: identity.key, memberRole: entry.event || entry.category, authorizationMetadata: authorizationMetadata(entry, manifest.package.contextId, index), createdAt: manifest.package.frozenAt }; });
}

function verifyStoredPackage(bundle) {
  if (!bundle?.package || !Array.isArray(bundle.members) || !Buffer.isBuffer(bundle.package.canonicalManifestBytes)) throw Object.assign(new Error("Stored Package is incomplete"), { code: "package_integrity_failure", statusCode: 409 });
  const fail = (message) => { throw Object.assign(new Error(message), { code: "package_integrity_failure", statusCode: 409 }); };
  const bytes = bundle.package.canonicalManifestBytes, digest = sha256(bytes);
  if (digest !== bundle.package.manifestFingerprintValue) fail("Stored canonical manifest digest does not match");
  let manifest; try { manifest = JSON.parse(bytes.toString("utf8")); } catch (_) { fail("Stored canonical manifest is not valid JSON"); }
  if (manifest.manifestVersion !== MANIFEST_VERSION || manifest.canonicalizationVersion !== CANONICALIZATION_VERSION) fail("Stored canonical manifest version is unsupported");
  if (!canonicalize(manifest).equals(bytes)) fail("Stored manifest bytes are not canonical");
  if (manifest.package?.id !== bundle.package.id || manifest.package?.contextId !== bundle.package.contextId || manifest.package?.subjectReferenceId !== bundle.package.subjectReferenceId) fail("Stored Package metadata does not match its manifest");
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== bundle.members.length) fail("Manifest membership count does not match relational membership");
  const expectedMembers=buildMembers(manifest);
  for (let index = 0; index < bundle.members.length; index++) { const member=bundle.members[index],expected=expectedMembers[index];if(member.packageId!==expected.packageId||member.ordinal!==expected.ordinal||member.memberType!==expected.memberType||member.canonicalMemberReference!==expected.canonicalMemberReference||member.memberRole!==expected.memberRole||canonicalize(member.canonicalMemberKey).toString("utf8")!==canonicalize(expected.canonicalMemberKey).toString("utf8")||canonicalize(member.authorizationMetadata).toString("utf8")!==canonicalize(expected.authorizationMetadata).toString("utf8"))fail("Manifest membership order/reference/authorization does not match relational membership"); }
  return { manifest, digest, integrityVerified: true, integrityMeaning: "Package manifest bytes and relational membership verified; Evidence truth, KYC and UBO were not verified" };
}

module.exports = { CANONICALIZATION_VERSION, MANIFEST_VERSION, MEMBER_TYPES, PURPOSE_CODES, buildManifest, buildMembers, requestFingerprint, validateFreezeInput, validateMemberReference, validatePurpose, verifyStoredPackage };
