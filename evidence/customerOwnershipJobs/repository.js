"use strict";

const { randomUUID } = require("node:crypto");

const rows = (result) => result?.rows || result || [];
const dataTimestamp = (value) => value instanceof Date ? value.toISOString() : value;

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contextId: row.context_id,
    artifactId: row.artifact_id,
    artifactSha256: row.artifact_sha256,
    cacheKey: row.cache_key,
    demoCaseId: row.demo_case_id,
    company: row.company || {},
    evidenceHandoff: row.evidence_handoff || null,
    profileVersion: row.profile_version,
    schemaVersion: row.schema_version,
    instructionVersion: row.instruction_version,
    verificationStrategyVersion: row.verification_strategy_version,
    provider: row.provider,
    modelVersion: row.model_version,
    state: row.state,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextAttemptAt: row.next_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    correlationId: row.correlation_id,
    lastReasonCode: row.last_reason_code,
    lastReasonMessage: row.last_reason_message,
    upstreamStatus: row.upstream_status == null ? null : Number(row.upstream_status),
    result: row.result || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

class PostgresCustomerExtractionJobRepository {
  constructor(db) { this.db = db; }

  async ensureContext({ tenantId, demoCaseId, company }) {
    return this.db.transaction(async (tx) => {
      const subjectResult = await tx.query(`INSERT INTO evidence_subject_references
        (subject_type,identifier_scheme,jurisdiction,identifier_value,display_name,external_system,external_reference)
        VALUES('legal_entity','company_registration',$1,$2,$3,'ubo_demo',$4)
        ON CONFLICT(subject_type,identifier_scheme,jurisdiction,identifier_value)
        DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`,
      [company.countryCode, company.registrationNumber, company.legalName, demoCaseId]);
      const subjectId = rows(subjectResult)[0].id;
      const contextId = randomUUID();
      const contextResult = await tx.query(`INSERT INTO evidence_contexts
        (id,tenant_id,context_type,external_context_reference,subject_reference_id)
        VALUES($1,$2,'ubo_customer_ownership_chart',$3,$4)
        ON CONFLICT(tenant_id,context_type,external_context_reference) WHERE external_context_reference IS NOT NULL
        DO UPDATE SET subject_reference_id=EXCLUDED.subject_reference_id RETURNING id,subject_reference_id`,
      [contextId, tenantId, demoCaseId, subjectId]);
      const context = rows(contextResult)[0];
      return { id: context.id, tenant_id: tenantId, subject_reference_id: context.subject_reference_id, display_name: company.legalName };
    });
  }

  async findArtifact({ tenantId, contextId, sha256 }) {
    const result = await this.db.query(`SELECT ar.id artifact_id,ar.asset_id,ac.id acquisition_id,ac.collection_operation_id collection_id,
      a.subject_reference_id,s.display_name,ac.tenant_id,ac.context_id,ar.original_name,ar.media_type,ar.size_bytes,
      ar.fingerprint_value,ar.captured_at,ar.storage_provider,ar.storage_key,ar.storage_reference,a.access_class
      FROM evidence_artifacts ar JOIN evidence_assets a ON a.id=ar.asset_id
      JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      JOIN evidence_subject_references s ON s.id=a.subject_reference_id
      WHERE ac.tenant_id=$1 AND ac.context_id=$2 AND ar.fingerprint_value=$3
      ORDER BY ar.created_at LIMIT 1`, [tenantId, contextId, sha256]);
    const row = rows(result)[0];
    if (!row) return null;
    return {
      artifactId: row.artifact_id, assetId: row.asset_id, acquisitionId: row.acquisition_id,
      collectionId: row.collection_id, subjectReferenceId: row.subject_reference_id,
      subjectDisplayName: row.display_name, tenantId: row.tenant_id, contextId: row.context_id,
      originalFilename: row.original_name, mediaType: row.media_type, sizeBytes: Number(row.size_bytes),
      fingerprintValue: row.fingerprint_value, capturedAt: dataTimestamp(row.captured_at),
      storageProvider: row.storage_provider, storageKey: row.storage_key,
      storageReference: row.storage_reference, accessClass: row.access_class,
    };
  }

  async createOrGetJob(record) {
    const id = record.id || randomUUID();
    const created = await this.db.query(`INSERT INTO evidence_customer_extraction_jobs
      (id,tenant_id,context_id,artifact_id,artifact_sha256,cache_key,demo_case_id,company,evidence_handoff,
       profile_version,schema_version,instruction_version,verification_strategy_version,provider,model_version,
       state,attempt_count,max_attempts,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,'QUEUED',0,$16,$17)
      ON CONFLICT(tenant_id,context_id,cache_key) DO NOTHING RETURNING *`,
    [id,record.tenantId,record.contextId,record.artifactId,record.artifactSha256,record.cacheKey,
      record.demoCaseId,JSON.stringify(record.company),record.evidenceHandoff ? JSON.stringify(record.evidenceHandoff) : null,
      record.profileVersion,record.schemaVersion,record.instructionVersion,record.verificationStrategyVersion,
      record.provider,record.modelVersion,record.maxAttempts,record.correlationId]);
    if (rows(created).length) return { created: true, job: mapJob(rows(created)[0]) };
    const existing = await this.db.query(`SELECT * FROM evidence_customer_extraction_jobs
      WHERE tenant_id=$1 AND context_id=$2 AND cache_key=$3`, [record.tenantId, record.contextId, record.cacheKey]);
    return { created: false, job: mapJob(rows(existing)[0]) };
  }

  async getJob({ id, tenantId }) {
    const result = await this.db.query("SELECT * FROM evidence_customer_extraction_jobs WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    return mapJob(rows(result)[0]);
  }

  async claimJob({ id, tenantId, leaseSeconds = 300 }) {
    const result = await this.db.query(`UPDATE evidence_customer_extraction_jobs SET
      state='RUNNING',attempt_count=attempt_count+1,next_attempt_at=NULL,
      lease_expires_at=NOW()+($3::text||' seconds')::interval,updated_at=NOW()
      WHERE id=$1 AND tenant_id=$2 AND attempt_count<max_attempts AND (
        state='QUEUED' OR (state='RETRYING' AND (next_attempt_at IS NULL OR next_attempt_at<=NOW()))
        OR (state='RUNNING' AND lease_expires_at<NOW())) RETURNING *`, [id, tenantId, leaseSeconds]);
    return mapJob(rows(result)[0]);
  }

  async markRetry({ id, code, message, upstreamStatus, nextAttemptAt }) {
    const result = await this.db.query(`UPDATE evidence_customer_extraction_jobs SET
      state='RETRYING',last_reason_code=$2,last_reason_message=$3,upstream_status=$4,
      next_attempt_at=$5,lease_expires_at=NULL,updated_at=NOW()
      WHERE id=$1 AND state='RUNNING' RETURNING *`, [id, code, message, upstreamStatus, nextAttemptAt]);
    return mapJob(rows(result)[0]);
  }

  async completeJob({ id, state, result }) {
    const updated = await this.db.query(`UPDATE evidence_customer_extraction_jobs SET
      state=$2,result=$3::jsonb,last_reason_code=NULL,last_reason_message=NULL,upstream_status=NULL,
      next_attempt_at=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND state='RUNNING' RETURNING *`, [id, state, JSON.stringify(result)]);
    return mapJob(rows(updated)[0]);
  }

  async failJob({ id, code, message, upstreamStatus }) {
    const result = await this.db.query(`UPDATE evidence_customer_extraction_jobs SET
      state='FAILED',last_reason_code=$2,last_reason_message=$3,upstream_status=$4,
      next_attempt_at=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND state IN ('QUEUED','RUNNING','RETRYING') RETURNING *`, [id, code, message, upstreamStatus]);
    return mapJob(rows(result)[0]);
  }

  async retryFailed({ id, tenantId, correlationId }) {
    const result = await this.db.query(`UPDATE evidence_customer_extraction_jobs SET
      state='QUEUED',attempt_count=0,next_attempt_at=NULL,lease_expires_at=NULL,completed_at=NULL,
      last_reason_code=NULL,last_reason_message=NULL,upstream_status=NULL,correlation_id=$3,updated_at=NOW()
      WHERE id=$1 AND tenant_id=$2 AND state='FAILED' RETURNING *`, [id, tenantId, correlationId]);
    return mapJob(rows(result)[0]);
  }

  async health() {
    const result = await this.db.query(`SELECT
      COUNT(*) FILTER (WHERE state IN ('QUEUED','RETRYING'))::int queued,
      COUNT(*) FILTER (WHERE state='RUNNING' AND lease_expires_at<NOW())::int stale
      FROM evidence_customer_extraction_jobs`);
    return rows(result)[0] || { queued: 0, stale: 0 };
  }
}

module.exports = { PostgresCustomerExtractionJobRepository, mapJob };
