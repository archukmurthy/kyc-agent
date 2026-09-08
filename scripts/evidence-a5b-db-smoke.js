#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildA3FixtureBundle } = require("../evidence/a3/fixtures");
const { PostgresA3Repository } = require("../evidence/a3/repository");
const { createPostgresDb } = require("../evidence/a2/postgresDb");
const { PostgresA5aRepository } = require("../evidence/a5a/repository");
const { EvidenceReconstructionService } = require("../evidence/a5a/service");
const { PostgresA5bRepository } = require("../evidence/a5b/repository");
const { EvidencePackageService } = require("../evidence/a5b/service");
const { loadEvidenceTestEnv, requireDisposableEvidenceDatabase } = require("./evidence-test-db-guard");

function statements(file) {
  return fs.readFileSync(path.resolve("db", "migrations", file), "utf8")
    .split("\n").map((line) => line.split("--")[0]).join("\n")
    .split(";").map((value) => value.trim()).filter(Boolean);
}

async function main() {
  loadEvidenceTestEnv();
  const db = createPostgresDb(requireDisposableEvidenceDatabase());
  const files = [
    "010_evidence_platform_a1.sql", "011_evidence_platform_a2.sql", "012_evidence_platform_a3.sql",
    "013_evidence_fact_artifact_support.sql", "014_evidence_need_evaluations.sql",
    "015_evidence_interpretation_operations.sql", "016_evidence_fact_artifact_locators.sql",
    "017_evidence_typed_relationships.sql", "018_evidence_coverage_assessments.sql",
    "019_evidence_packages.sql",
  ];
  try {
    await db.query("CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE)");
    for (const file of files) for (const statement of statements(file)) await db.query(`${statement};`);
    for (const tenant of ["nium", "acme"]) await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,$1,$1) ON CONFLICT(id) DO NOTHING", [tenant]);
    const fixture = await buildA3FixtureBundle();
    await new PostgresA3Repository(db).persistBundle(fixture);

    const clock = () => new Date("2026-09-04T12:00:00.000Z");
    const ids = [
      "a5b00000-0000-4000-8000-000000000001",
      "a5b00000-0000-4000-8000-000000000002",
      "a5b00000-0000-4000-8000-000000000003",
    ];
    const repository = new PostgresA5bRepository(db);
    const reconstructionService = new EvidenceReconstructionService({ repository: new PostgresA5aRepository(db), clock });
    const service = new EvidencePackageService({ repository, reconstructionService, clock, idFactory: () => ids.shift() });
    const common = {
      tenantId: "nium", contextId: "20000000-0000-4000-8000-000000000001",
      subjectReferenceId: "10000000-0000-4000-8000-000000000001", asOf: "2026-09-03T12:00:00.000Z",
      purpose: { code: "regulatory_reconstruction" }, callerScope: "a5b_db_smoke",
      actor: { type: "system", id: "a5b-db-smoke" },
    };

    const first = await service.freezePackage({ ...common, operationKey: "smoke-freeze-p1" });
    assert.equal(first.replayed, false);
    assert.equal(first.integrity.verified, true);
    assert.notEqual(first.package.id, first.integrity.manifestSha256);
    const frozenBytes = Buffer.from((await repository.getPackage({ tenantId: common.tenantId, contextId: common.contextId, packageId: first.package.id })).package.canonicalManifestBytes);
    const requirement = first.manifest.entries.find((entry) => entry.sourceRecordType === "evidence_requirement");
    assert.ok(requirement);
    await db.query("UPDATE evidence_requirements SET status='closed' WHERE id=$1", [requirement.evidenceReference.id]);
    const reopened = await service.reopenPackage({ tenantId: common.tenantId, contextId: common.contextId, packageId: first.package.id });
    assert.equal(reopened.manifest.entries.find((entry) => entry.evidenceReference.id === requirement.evidenceReference.id).status, requirement.status);
    assert.ok(Buffer.from((await repository.getPackage({ tenantId: common.tenantId, contextId: common.contextId, packageId: first.package.id })).package.canonicalManifestBytes).equals(frozenBytes));

    const retry = await service.freezePackage({ ...common, operationKey: "smoke-freeze-p1" });
    assert.equal(retry.package.id, first.package.id);
    assert.equal(retry.replayed, true);
    await assert.rejects(
      () => service.freezePackage({ ...common, operationKey: "smoke-freeze-p1", purpose: { code: "internal_review" } }),
      (error) => error.code === "idempotency_conflict"
    );
    const second = await service.freezePackage({ ...common, operationKey: "smoke-freeze-p2", derivedFromPackageId: first.package.id });
    assert.notEqual(second.package.id, first.package.id);
    assert.equal(second.package.derivedFromPackageId, first.package.id);
    const sharedArtifact = first.manifest.entries.find((entry) => entry.sourceRecordType === "evidence_artifact");
    assert.ok(sharedArtifact);
    const membership = await db.query("SELECT count(*)::int count FROM evidence_package_members WHERE canonical_member_reference=$1", [`evidence_artifact:${sharedArtifact.evidenceReference.id}`]);
    assert.equal(membership.rows[0].count, 2);

    const privateCommon = { ...common, contextId: "20000000-0000-4000-8000-000000000004", operationKey: "smoke-private-p1" };
    const privatePackage = await service.freezePackage(privateCommon);
    const privateAsset = privatePackage.manifest.entries.find((entry) => entry.sourceRecordType === "evidence_asset" && entry.details.accessClass === "context_restricted");
    assert.ok(privateAsset);
    await db.query("DELETE FROM evidence_asset_access_scopes WHERE asset_id=$1 AND tenant_id=$2 AND context_id=$3", [privateAsset.evidenceReference.id, privateCommon.tenantId, privateCommon.contextId]);
    await assert.rejects(
      () => service.reopenPackage({ tenantId: privateCommon.tenantId, contextId: privateCommon.contextId, packageId: privatePackage.package.id }),
      (error) => error.code === "package_exists_but_not_materializable_under_current_authorization" && error.nonDisclosing === true
    );

    assert.equal((await db.query("SELECT count(*)::int count FROM evidence_packages WHERE id=ANY($1::uuid[])", [[first.package.id, second.package.id, privatePackage.package.id]])).rows[0].count, 3);
    assert.ok((await db.query("SELECT count(*)::int count FROM evidence_package_members WHERE package_id=$1", [first.package.id])).rows[0].count > 0);
    console.log("Evidence A5b disposable-DB smoke passed through migration 019: immutable canonical manifest, relational membership, replay/conflict, new Package history, frozen-state reopening, shared source membership and fail-closed access loss verified; no source, provider, A4a or A4b call was made");
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
