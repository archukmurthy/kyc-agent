"use strict";

const crypto = require("node:crypto");
const { canonicalize, sha256 } = require("./canonicalize");
const { CANONICALIZATION_VERSION, MANIFEST_VERSION, buildManifest, buildMembers, requestFingerprint, validateFreezeInput, verifyStoredPackage } = require("./domain");
const { AVAILABILITY_RULES_VERSION } = require("../a5a/domain");

function denied(message = "The Package is not accessible in this Evidence context") { return Object.assign(new Error(message), { code: "package_access_denied", statusCode: 403 }); }
function unavailable() { return Object.assign(new Error("Package exists but cannot be materialized under current authorization"), { code: "package_exists_but_not_materializable_under_current_authorization", statusCode: 403, nonDisclosing: true }); }
function publicPackage(row) { const { canonicalManifestBytes, requestFingerprint, ...safe } = row; return safe; }

class EvidencePackageService {
  constructor({ repository, reconstructionService, clock = () => new Date(), idFactory = () => crypto.randomUUID() }) { if (!repository || !reconstructionService) throw new Error("EvidencePackageService requires repository and reconstructionService"); this.repository = repository; this.reconstructionService = reconstructionService; this.clock = clock; this.idFactory = idFactory; }
  async assertContext(input) { const context = await this.repository.authorizeContext({ tenantId: input.tenantId, contextId: input.contextId, subjectReferenceId: input.subjectReferenceId }); if (!context) throw denied(); return context; }
  async freezePackage(raw) {
    const input = validateFreezeInput(raw); await this.assertContext(input);
    const fingerprint = requestFingerprint(input, AVAILABILITY_RULES_VERSION);
    const replay = await this.repository.findByOperationKey({ tenantId: input.tenantId, contextId: input.contextId, callerScope: input.callerScope, operationKey: input.operationKey });
    if (replay) { if (replay.package.requestFingerprint !== fingerprint) throw Object.assign(new Error("The freeze operation key was already used with different Package inputs"), { code: "idempotency_conflict", statusCode: 409 }); return this.materialize(replay, input, { replayed: true }); }
    if (input.derivedFromPackageId) { const predecessor = await this.repository.getPackage({ tenantId: input.tenantId, contextId: input.contextId, packageId: input.derivedFromPackageId }); if (!predecessor || predecessor.package.subjectReferenceId !== input.subjectReferenceId) throw denied("The predecessor Package is not accessible for this subject/context"); }
    const reconstruction = await this.reconstructionService.reconstructEvidence({ authorizedTenant: input.tenantId, authorizedContext: input.contextId, subject: input.subjectReferenceId, asOf: input.asOf });
    const packageId = this.idFactory().toLowerCase(), frozenAt = this.clock().toISOString();
    if (new Date(input.asOf).getTime() > new Date(frozenAt).getTime()) throw Object.assign(new Error("asOf cannot be later than freeze time"), { code: "future_as_of", statusCode: 400 });
    const manifest = buildManifest({ packageId, input, reconstruction, frozenAt }), bytes = canonicalize(manifest), digest = sha256(bytes), members = buildMembers(manifest);
    const packageRow = { id: packageId, tenantId: input.tenantId, contextId: input.contextId, subjectReferenceId: input.subjectReferenceId, purposeCode: input.purpose.code, purposeLabel: input.purpose.label, asOf: input.asOf, frozenAt, frozenByActorType: input.actor.type, frozenByActorId: input.actor.id, callerScope: input.callerScope, freezeOperationKey: input.operationKey, requestFingerprint: fingerprint, a5aAvailabilityRulesVersion: reconstruction.availabilityRulesVersion, manifestVersion: MANIFEST_VERSION, canonicalizationVersion: CANONICALIZATION_VERSION, canonicalManifestBytes: bytes, manifestFingerprintAlgorithm: "sha256", manifestFingerprintValue: digest, limitations: reconstruction.limitations || [], derivedFromPackageId: input.derivedFromPackageId, createdAt: frozenAt };
    let persisted; try { persisted = await this.repository.persistPackage({ package: packageRow, members }, input); } catch (error) { if (error.code !== "23505") throw error; const concurrent = await this.repository.findByOperationKey({ tenantId: input.tenantId, contextId: input.contextId, callerScope: input.callerScope, operationKey: input.operationKey }); if (!concurrent || concurrent.package.requestFingerprint !== fingerprint) throw Object.assign(new Error("The freeze operation key was already used with different Package inputs"), { code: "idempotency_conflict", statusCode: 409 }); persisted = concurrent; }
    return this.materialize(persisted, input, { replayed: false, freshFreeze: true });
  }
  async materialize(bundle, input, { replayed = false, verifyOnly = false, freshFreeze = false } = {}) {
    const verified = verifyStoredPackage(bundle);
    if (!await this.repository.authorizeMembers({ tenantId: input.tenantId, contextId: input.contextId, subjectReferenceId: bundle.package.subjectReferenceId, members: bundle.members })) throw unavailable();
    return { package: publicPackage(bundle.package), manifest: verifyOnly ? undefined : verified.manifest, integrity: { verified: true, meaning: verified.integrityMeaning, manifestSha256: verified.digest, evidenceTruthVerified: false, kycApproved: false, uboApproved: false }, replayed, sideEffects: { sourceCall: false, providerCall: false, a4aRecalculation: false, a4bRecalculation: false, a5aReconstruction: freshFreeze, writes: freshFreeze } };
  }
  async reopenPackage({ tenantId, contextId, packageId }) { const input = { tenantId, contextId, subjectReferenceId: null }; const context = await this.repository.authorizeContext({ tenantId, contextId }); if (!context) throw denied(); const bundle = await this.repository.getPackage({ tenantId, contextId, packageId }); if (!bundle) throw Object.assign(new Error("Package was not found in this authorized context"), { code: "package_not_found", statusCode: 404 }); input.subjectReferenceId = bundle.package.subjectReferenceId; return this.materialize(bundle, input); }
  async verifyPackageManifest({ tenantId, contextId, packageId }) { const result = await this.reopenPackage({ tenantId, contextId, packageId }); return { package: result.package, integrity: result.integrity, sideEffects: result.sideEffects }; }
  async listAuthorizedPackages({ tenantId, contextId, subjectReferenceId }) { const input = { tenantId, contextId, subjectReferenceId }; await this.assertContext(input); return { packages: (await this.repository.listPackages(input)).map(publicPackage), sideEffects: { sourceCall: false, providerCall: false, a4aRecalculation: false, a4bRecalculation: false, a5aReconstruction: false, writes: false } }; }
}

module.exports = { EvidencePackageService, denied, unavailable };
