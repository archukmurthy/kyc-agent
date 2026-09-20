"use strict";

const { randomUUID } = require("node:crypto");

function rows(result) { return result?.rows || result || []; }
function mapOperation(row) {
  if (!row) return null;
  return { id: row.id, tenantId: row.tenant_id, contextId: row.context_id, callerScope: row.caller_scope, operationKey: row.operation_key, requestFingerprint: row.request_fingerprint, requestManifest: row.request_manifest || {}, correlation: row.correlation || {}, trustedCallerMetadata: row.trusted_caller_metadata || {}, status: row.status, extractionRunId: row.extraction_run_id, result: row.result_summary || {}, failure: row.failure_code ? { code: row.failure_code, message: row.failure_message } : null, startedAt: row.started_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

class MemoryR2Repository {
  constructor({ artifacts = [], contexts = [] } = {}) { this.operations = new Map(); this.artifacts = artifacts; this.contexts = contexts; this.writes = 0; }
  key(record) { return `${record.tenantId}|${record.contextId}|${record.callerScope}|${record.operationKey}`; }
  async claimOperation(record) {
    const key = this.key(record); const existing = this.operations.get(key);
    if (existing) return { created: false, operation: structuredClone(existing) };
    const operation = { ...structuredClone(record), id: record.id || randomUUID(), status: "in_progress", result: {}, failure: null, completedAt: null, createdAt: record.startedAt, updatedAt: record.startedAt };
    this.operations.set(key, operation); this.writes += 1; return { created: true, operation: structuredClone(operation) };
  }
  async completeOperation(id, { extractionRunId, result, completedAt }) { const found = [...this.operations.entries()].find(([, item]) => item.id === id); if (!found) throw new Error("operation not found"); found[1].status = "completed"; found[1].extractionRunId = extractionRunId; found[1].result = structuredClone(result); found[1].completedAt = completedAt; found[1].updatedAt = completedAt; this.writes += 1; return structuredClone(found[1]); }
  async failOperation(id, { code, message, extractionRunId = null, completedAt }) { const found = [...this.operations.entries()].find(([, item]) => item.id === id); if (!found) return null; found[1].status = "failed"; found[1].extractionRunId = extractionRunId; found[1].failure = { code, message }; found[1].completedAt = completedAt; found[1].updatedAt = completedAt; this.writes += 1; return structuredClone(found[1]); }
  async listOperations({ tenantId, contextId, callerScope, artifactIds = [] }) { return [...this.operations.values()].filter((item) => item.tenantId === tenantId && item.contextId === contextId && item.callerScope === callerScope && (!artifactIds.length || artifactIds.some((id) => item.requestManifest.artifactIds?.includes(id)))).map((item)=>structuredClone(item)); }
  async listOptions({ tenantId, contextId = null }) { const contexts = this.contexts.filter((item) => item.tenantId === tenantId && (!contextId || item.id === contextId)); return { contexts: structuredClone(contexts), assets: [] }; }
}

class PostgresR2Repository {
  constructor(db) { if (!db?.query) throw new Error("PostgresR2Repository requires db.query"); this.db = db; }
  async claimOperation(record) {
    const id = record.id || randomUUID();
    const result = await this.db.query(`INSERT INTO evidence_interpretation_operations
      (id,tenant_id,context_id,caller_scope,operation_key,request_fingerprint,request_manifest,correlation,trusted_caller_metadata,status,started_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'in_progress',$10,$10,$10)
      ON CONFLICT(tenant_id,context_id,caller_scope,operation_key) DO NOTHING RETURNING *`,
      [id,record.tenantId,record.contextId,record.callerScope,record.operationKey,record.requestFingerprint,JSON.stringify(record.requestManifest),JSON.stringify(record.correlation||{}),JSON.stringify(record.trustedCallerMetadata||{}),record.startedAt]);
    if (rows(result).length) return { created: true, operation: mapOperation(rows(result)[0]) };
    const existing = await this.db.query(`SELECT * FROM evidence_interpretation_operations WHERE tenant_id=$1 AND context_id=$2 AND caller_scope=$3 AND operation_key=$4`, [record.tenantId,record.contextId,record.callerScope,record.operationKey]);
    return { created: false, operation: mapOperation(rows(existing)[0]) };
  }
  async completeOperation(id, { extractionRunId, result, completedAt }) {
    const updated = await this.db.query(`UPDATE evidence_interpretation_operations SET status='completed',extraction_run_id=$2,result_summary=$3::jsonb,completed_at=$4,updated_at=$4 WHERE id=$1 AND status='in_progress' RETURNING *`, [id,extractionRunId,JSON.stringify(result),completedAt]);
    if (!rows(updated).length) throw Object.assign(new Error("Interpretation operation is no longer in progress"), { code: "operation_state_conflict" });
    return mapOperation(rows(updated)[0]);
  }
  async failOperation(id, { code, message, extractionRunId = null, completedAt }) {
    const updated = await this.db.query(`UPDATE evidence_interpretation_operations SET status='failed',extraction_run_id=$2,failure_code=$3,failure_message=$4,completed_at=$5,updated_at=$5 WHERE id=$1 AND status='in_progress' RETURNING *`, [id,extractionRunId,code,message,completedAt]);
    return mapOperation(rows(updated)[0]);
  }
  async listOperations({ tenantId, contextId, callerScope, artifactIds = [] }) {
    const result = await this.db.query(`SELECT * FROM evidence_interpretation_operations WHERE tenant_id=$1 AND context_id=$2 AND caller_scope=$3 ORDER BY created_at DESC`, [tenantId,contextId,callerScope]);
    return rows(result).map(mapOperation).filter((operation) => !artifactIds.length || artifactIds.some((id) => operation.requestManifest.artifactIds?.includes(id)));
  }
  async listOptions({ tenantId, contextId = null }) {
    const contextResult = await this.db.query(`SELECT c.id,c.tenant_id,c.context_type,c.external_context_reference,c.subject_reference_id,c.created_at,s.display_name,s.identifier_scheme,s.identifier_value,s.jurisdiction
      FROM evidence_contexts c JOIN evidence_subject_references s ON s.id=c.subject_reference_id
      WHERE c.tenant_id=$1 AND ($2::uuid IS NULL OR c.id=$2::uuid) ORDER BY c.created_at DESC`, [tenantId,contextId]);
    const contexts = rows(contextResult).map((row) => ({ id:row.id,tenantId:row.tenant_id,contextType:row.context_type,externalReference:row.external_context_reference,subjectReferenceId:row.subject_reference_id,subjectDisplayName:row.display_name,subjectIdentifier:`${row.identifier_scheme}: ${row.identifier_value}`,jurisdiction:row.jurisdiction,createdAt:row.created_at }));
    if (!contextId) return { contexts, assets: [] };
    const artifactResult = await this.db.query(`SELECT a.id asset_id,a.title,a.evidence_type,a.access_class,a.subject_reference_id,a.observed_at,ac.collection_operation_id,ac.source_type,ac.source_provider,ac.source_locator,
      ar.id artifact_id,ar.representation_type,ar.media_type,ar.original_name,ar.size_bytes,ar.fingerprint_value,ar.captured_at,ar.artifact_metadata
      FROM evidence_contexts c JOIN evidence_assets a ON a.subject_reference_id=c.subject_reference_id
      JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id JOIN evidence_artifacts ar ON ar.asset_id=a.id
      WHERE c.id=$1 AND c.tenant_id=$2 AND (a.access_class='public' OR (ac.tenant_id=$2 AND ac.context_id=$1 AND EXISTS(
        SELECT 1 FROM evidence_asset_access_scopes scope WHERE scope.asset_id=a.id AND scope.tenant_id=$2 AND scope.context_id=$1)))
      AND (ar.fixture_content IS NOT NULL OR ar.storage_provider IN ('filesystem','vercel_blob'))
      ORDER BY a.observed_at DESC,a.id,COALESCE((ar.artifact_metadata->>'pageOrder')::int,(ar.artifact_metadata->>'pageNumber')::int,0),ar.captured_at,ar.id`, [contextId,tenantId]);
    const byAsset = new Map();
    for (const row of rows(artifactResult)) {
      if (!byAsset.has(row.asset_id)) byAsset.set(row.asset_id,{ id:row.asset_id,title:row.title,evidenceType:row.evidence_type,accessClass:row.access_class,subjectReferenceId:row.subject_reference_id,observedAt:row.observed_at,collectionOperationId:row.collection_operation_id,source:{type:row.source_type,provider:row.source_provider,locator:row.source_locator},artifacts:[] });
      byAsset.get(row.asset_id).artifacts.push({ id:row.artifact_id,representationType:row.representation_type,mediaType:row.media_type,originalFilename:row.original_name,sizeBytes:Number(row.size_bytes),fingerprintValue:row.fingerprint_value,capturedAt:row.captured_at,order:row.artifact_metadata?.pageOrder??row.artifact_metadata?.pageNumber??null });
    }
    return { contexts, assets:[...byAsset.values()] };
  }
}

class R2A3RepositoryAdapter {
  constructor(repository) { this.repository=repository; }
  findArtifactForInterpretation(input){return this.repository.findArtifactForInterpretation(input);}
  findDeterministicValues(artifactId){return this.repository.findDeterministicValues?this.repository.findDeterministicValues(artifactId):[];}
  listInterpretations(artifactId){return this.repository.listInterpretations?this.repository.listInterpretations(artifactId):{runs:[],facts:[]};}
  appendInterpretation(bundle){
    const facts=(bundle.facts||[]).map((fact)=>fact.requestStatus==="requested"&&!fact.informationNeedId&&!fact.schemaFieldId?{...fact,requestStatus:"discovered",supportSignals:{...(fact.supportSignals||{}),neutralRequestedConceptResponse:true}}:fact);
    return this.repository.appendInterpretation({...bundle,facts});
  }
}

module.exports = { MemoryR2Repository, PostgresR2Repository, R2A3RepositoryAdapter, mapOperation };
