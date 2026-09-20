"use strict";

function rows(result) { return result?.rows || result || []; }
function camel(row) { if (!row) return null; const out = {}; for (const [key, value] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value; return out; }
function clone(value) { if (Buffer.isBuffer(value)) return Buffer.from(value); if (Array.isArray(value)) return value.map(clone); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])); return value; }

class MemoryA5bRepository {
  constructor({ contexts = [], deniedAssetIds = [] } = {}) { this.contexts = contexts; this.deniedAssetIds = new Set(deniedAssetIds); this.packages = []; this.members = []; this.writes = 0; this.sourceCalls = 0; this.providerCalls = 0; }
  async authorizeContext({ tenantId, contextId, subjectReferenceId = null }) { return clone(this.contexts.find((x) => x.tenantId === tenantId && x.id === contextId && (!subjectReferenceId || x.subjectReferenceId === subjectReferenceId)) || null); }
  async findByOperationKey({ tenantId, contextId, callerScope, operationKey }) { const found = this.packages.find((x) => x.tenantId === tenantId && x.contextId === contextId && x.callerScope === callerScope && x.freezeOperationKey === operationKey); return found ? this.bundle(found) : null; }
  async getPackage({ tenantId, contextId, packageId }) { const found = this.packages.find((x) => x.id === packageId && x.tenantId === tenantId && x.contextId === contextId); return found ? this.bundle(found) : null; }
  async listPackages({ tenantId, contextId, subjectReferenceId }) { return this.packages.filter((x) => x.tenantId === tenantId && x.contextId === contextId && x.subjectReferenceId === subjectReferenceId).sort((a, b) => b.frozenAt.localeCompare(a.frozenAt)).map((x) => clone({ ...x, canonicalManifestBytes: undefined })); }
  async authorizeMembers({ tenantId, contextId, subjectReferenceId, members }) { const context = await this.authorizeContext({ tenantId, contextId, subjectReferenceId }); if (!context) return false; return members.every((member) => member.authorizationMetadata?.kind !== "asset" || (member.authorizationMetadata.assetIds || []).every((id) => !this.deniedAssetIds.has(id))); }
  async persistPackage(bundle, authorization) { if (!await this.authorizeMembers({ ...authorization, members: bundle.members })) throw Object.assign(new Error("A Package member is not currently authorized"), { code: "package_member_access_denied", statusCode: 403 }); const existing = await this.findByOperationKey({ ...authorization, callerScope: bundle.package.callerScope, operationKey: bundle.package.freezeOperationKey }); if (existing) throw Object.assign(new Error("Freeze operation key already exists"), { code: "23505" }); this.packages.push(clone(bundle.package)); this.members.push(...clone(bundle.members)); this.writes += 1 + bundle.members.length; return this.bundle(bundle.package); }
  bundle(packageRow) { return { package: clone(packageRow), members: clone(this.members.filter((x) => x.packageId === packageRow.id).sort((a, b) => a.ordinal - b.ordinal)) }; }
}

async function authorizationAllowed(queryable, { tenantId, contextId, subjectReferenceId, members }) {
  const context = rows(await queryable.query("SELECT id FROM evidence_contexts WHERE id=$2 AND tenant_id=$1 AND subject_reference_id=$3", [tenantId, contextId, subjectReferenceId]))[0];
  if (!context) return false;
  const assetIds = [...new Set(members.flatMap((member) => member.authorizationMetadata?.kind === "asset" ? member.authorizationMetadata.assetIds || [] : []))];
  if (!assetIds.length) return true;
  const result = await queryable.query(`SELECT a.id FROM evidence_assets a JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
    WHERE a.id=ANY($1::uuid[]) AND (a.access_class='public' OR (a.access_class='context_restricted' AND ac.tenant_id=$2 AND ac.context_id=$3
      AND EXISTS(SELECT 1 FROM evidence_asset_access_scopes scope WHERE scope.asset_id=a.id AND scope.tenant_id=$2 AND scope.context_id=$3)))`, [assetIds, tenantId, contextId]);
  return new Set(rows(result).map((x) => x.id)).size === assetIds.length;
}

function mapPackage(row) { const item = camel(row); if (item?.canonicalManifestBytes && !Buffer.isBuffer(item.canonicalManifestBytes)) item.canonicalManifestBytes = Buffer.from(item.canonicalManifestBytes); return item; }
function mapMember(row) { return camel(row); }

class PostgresA5bRepository {
  constructor(db) { if (!db?.query || !db?.transaction) throw new Error("PostgresA5bRepository requires transaction-capable db"); this.db = db; }
  async authorizeContext({ tenantId, contextId, subjectReferenceId = null }) { const result = await this.db.query("SELECT id,tenant_id,context_type,external_context_reference,subject_reference_id,created_at FROM evidence_contexts WHERE id=$2 AND tenant_id=$1 AND ($3::uuid IS NULL OR subject_reference_id=$3::uuid)", [tenantId, contextId, subjectReferenceId]); return camel(rows(result)[0]); }
  async packageQuery(where, params) { const result = await this.db.query(`SELECT * FROM evidence_packages WHERE ${where}`, params), packageRow = mapPackage(rows(result)[0]); if (!packageRow) return null; const members = rows(await this.db.query("SELECT * FROM evidence_package_members WHERE package_id=$1 ORDER BY ordinal", [packageRow.id])).map(mapMember); return { package: packageRow, members }; }
  async findByOperationKey({ tenantId, contextId, callerScope, operationKey }) { return this.packageQuery("tenant_id=$1 AND context_id=$2 AND caller_scope=$3 AND freeze_operation_key=$4", [tenantId, contextId, callerScope, operationKey]); }
  async getPackage({ tenantId, contextId, packageId }) { return this.packageQuery("id=$3 AND tenant_id=$1 AND context_id=$2", [tenantId, contextId, packageId]); }
  async listPackages({ tenantId, contextId, subjectReferenceId }) { const result = await this.db.query(`SELECT id,tenant_id,context_id,subject_reference_id,purpose_code,purpose_label,as_of,frozen_at,frozen_by_actor_type,frozen_by_actor_id,caller_scope,a5a_availability_rules_version,manifest_version,canonicalization_version,manifest_fingerprint_algorithm,manifest_fingerprint_value,limitations,derived_from_package_id,created_at
    FROM evidence_packages WHERE tenant_id=$1 AND context_id=$2 AND subject_reference_id=$3 ORDER BY frozen_at DESC,id`, [tenantId, contextId, subjectReferenceId]); return rows(result).map(mapPackage); }
  async authorizeMembers(args) { return authorizationAllowed(this.db, args); }
  async persistPackage(bundle, authorization) {
    return this.db.transaction(async (tx) => {
      if (!await authorizationAllowed(tx, { ...authorization, members: bundle.members })) throw Object.assign(new Error("A Package member is not currently authorized"), { code: "package_member_access_denied", statusCode: 403 });
      const p = bundle.package;
      await tx.query(`INSERT INTO evidence_packages(id,tenant_id,context_id,subject_reference_id,purpose_code,purpose_label,as_of,frozen_at,frozen_by_actor_type,frozen_by_actor_id,caller_scope,freeze_operation_key,request_fingerprint,a5a_availability_rules_version,manifest_version,canonicalization_version,canonical_manifest_bytes,manifest_fingerprint_algorithm,manifest_fingerprint_value,limitations,derived_from_package_id,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'sha256',$18,$19::jsonb,$20,$21)`, [p.id,p.tenantId,p.contextId,p.subjectReferenceId,p.purposeCode,p.purposeLabel,p.asOf,p.frozenAt,p.frozenByActorType,p.frozenByActorId,p.callerScope,p.freezeOperationKey,p.requestFingerprint,p.a5aAvailabilityRulesVersion,p.manifestVersion,p.canonicalizationVersion,p.canonicalManifestBytes,p.manifestFingerprintValue,JSON.stringify(p.limitations),p.derivedFromPackageId,p.createdAt]);
      for (const member of bundle.members) await tx.query(`INSERT INTO evidence_package_members(package_id,ordinal,member_type,canonical_member_reference,canonical_member_key,member_role,authorization_metadata,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)`, [member.packageId,member.ordinal,member.memberType,member.canonicalMemberReference,JSON.stringify(member.canonicalMemberKey),member.memberRole,JSON.stringify(member.authorizationMetadata || {}),member.createdAt]);
      return { package: p, members: bundle.members };
    });
  }
}

module.exports = { MemoryA5bRepository, PostgresA5bRepository, authorizationAllowed, mapMember, mapPackage };
