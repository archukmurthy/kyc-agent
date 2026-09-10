"use strict";

const rows=(result)=>result?.rows||result||[];
const camel=(key)=>key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
function mapRow(row){return Object.fromEntries(Object.entries(row).map(([key,value])=>[camel(key),key==="size_bytes"&&value!=null?Number(value):value]));}
function mapped(result){return rows(result).map(mapRow);}

const AUTHORIZED_ASSETS=`WITH selected AS (
  SELECT id,tenant_id,subject_reference_id FROM evidence_contexts WHERE id=$2 AND tenant_id=$1
), authorized_assets AS (
  SELECT DISTINCT a.id FROM selected s JOIN evidence_assets a ON a.subject_reference_id=s.subject_reference_id
  JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
  WHERE a.access_class='public' OR (a.access_class='context_restricted' AND ac.tenant_id=s.tenant_id AND ac.context_id=s.id
    AND EXISTS(SELECT 1 FROM evidence_asset_access_scopes scope WHERE scope.asset_id=a.id AND scope.tenant_id=s.tenant_id AND scope.context_id=s.id))
)`;

class MemoryA5aRepository {
  constructor({contexts=[],records={}}={}){this.contexts=contexts;this.records=records;this.reads=0;this.writes=0;this.sourceCalls=0;this.providerCalls=0;}
  async listContexts(tenantId){this.reads++;return structuredClone(this.contexts.filter((item)=>item.tenantId===tenantId));}
  async authorizeContext(tenantId,contextId){this.reads++;return structuredClone(this.contexts.find((item)=>item.tenantId===tenantId&&item.id===contextId)||null);}
  async loadRecords(){this.reads++;return structuredClone(this.records);}
}

class PostgresA5aRepository {
  constructor(db){if(!db?.query)throw new Error("PostgresA5aRepository requires db.query");this.db=db;}
  async listContexts(tenantId){const result=await this.db.query(`SELECT c.id,c.tenant_id,c.context_type,c.external_context_reference,c.subject_reference_id,c.created_at,s.subject_type,s.identifier_scheme,s.identifier_value,s.jurisdiction,s.display_name FROM evidence_contexts c JOIN evidence_subject_references s ON s.id=c.subject_reference_id WHERE c.tenant_id=$1 ORDER BY c.created_at DESC,c.id`,[tenantId]);return mapped(result);}
  async authorizeContext(tenantId,contextId){const result=await this.db.query(`SELECT c.id,c.tenant_id,c.context_type,c.external_context_reference,c.subject_reference_id,c.created_at,s.subject_type,s.identifier_scheme,s.identifier_value,s.jurisdiction,s.display_name FROM evidence_contexts c JOIN evidence_subject_references s ON s.id=c.subject_reference_id WHERE c.id=$2 AND c.tenant_id=$1`,[tenantId,contextId]);return mapped(result)[0]||null;}
  async loadRecords({tenantId,contextId}){
    const params=[tenantId,contextId];
    const queries={
      requirements:`SELECT r.* FROM evidence_requirements r JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
      needs:`SELECT n.*,r.context_id,r.subject_reference_id FROM evidence_requirement_information_needs n JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
      acquisitions:`${AUTHORIZED_ASSETS}, relevant_acquisitions AS (SELECT a.acquisition_id id FROM evidence_assets a JOIN authorized_assets aa ON aa.id=a.id UNION SELECT ac.id FROM evidence_acquisitions ac JOIN selected s ON ac.tenant_id=s.tenant_id AND ac.context_id=s.id AND ac.subject_reference_id=s.subject_reference_id) SELECT ac.* FROM evidence_acquisitions ac JOIN relevant_acquisitions relevant ON relevant.id=ac.id`,
      collections:`${AUTHORIZED_ASSETS}, relevant_acquisitions AS (SELECT a.acquisition_id id FROM evidence_assets a JOIN authorized_assets aa ON aa.id=a.id UNION SELECT ac.id FROM evidence_acquisitions ac JOIN selected s ON ac.tenant_id=s.tenant_id AND ac.context_id=s.id AND ac.subject_reference_id=s.subject_reference_id), relevant_collections AS (SELECT DISTINCT ac.collection_operation_id id FROM evidence_acquisitions ac JOIN relevant_acquisitions relevant ON relevant.id=ac.id WHERE ac.collection_operation_id IS NOT NULL UNION SELECT co.id FROM evidence_collection_operations co JOIN selected s ON co.producer='private_artifact_ingestion' AND co.collection_coordinates->>'contextId'=s.id::text) SELECT co.*,COALESCE(MIN(ac.context_id::text)::uuid,$2::uuid) context_id FROM evidence_collection_operations co JOIN relevant_collections relevant ON relevant.id=co.id LEFT JOIN evidence_acquisitions ac ON ac.collection_operation_id=co.id GROUP BY co.id`,
      assets:`${AUTHORIZED_ASSETS} SELECT a.* FROM evidence_assets a JOIN authorized_assets aa ON aa.id=a.id`,
      artifacts:`${AUTHORIZED_ASSETS} SELECT ar.id,ar.asset_id,ar.representation_type,ar.media_type,ar.original_name,ar.size_bytes,ar.fingerprint_algorithm,ar.fingerprint_value,ar.captured_at,ar.artifact_metadata,ar.created_at FROM evidence_artifacts ar JOIN authorized_assets aa ON aa.id=ar.asset_id`,
      extractionRuns:`${AUTHORIZED_ASSETS} SELECT er.*,ac.context_id,a.subject_reference_id FROM evidence_extraction_runs er JOIN evidence_assets a ON a.id=er.asset_id JOIN authorized_assets aa ON aa.id=a.id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id`,
      extractedValues:`${AUTHORIZED_ASSETS} SELECT value.* FROM evidence_extracted_values value JOIN evidence_extraction_runs er ON er.id=value.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      requirementAssets:`${AUTHORIZED_ASSETS} SELECT link.* FROM evidence_requirement_assets link JOIN evidence_requirements requirement ON requirement.id=link.requirement_id JOIN selected s ON s.id=requirement.context_id JOIN authorized_assets aa ON aa.id=link.asset_id`,
      runArtifacts:`${AUTHORIZED_ASSETS} SELECT input.* FROM evidence_extraction_run_artifacts input JOIN evidence_extraction_runs er ON er.id=input.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      facts:`${AUTHORIZED_ASSETS} SELECT f.*,ac.context_id,a.subject_reference_id FROM evidence_facts f JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN evidence_assets a ON a.id=er.asset_id JOIN authorized_assets aa ON aa.id=a.id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id`,
      supports:`${AUTHORIZED_ASSETS} SELECT support.* FROM evidence_fact_artifact_support support JOIN evidence_facts f ON f.id=support.fact_id JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      locators:`${AUTHORIZED_ASSETS} SELECT locator.* FROM evidence_fact_artifact_locators locator JOIN evidence_facts f ON f.id=locator.fact_id JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      typedRelationships:`${AUTHORIZED_ASSETS} SELECT relation.*,relation.exact_value::float8 exact_value,relation.range_lower::float8 range_lower,relation.range_upper::float8 range_upper,relation.numerator::float8 numerator,relation.denominator::float8 denominator FROM evidence_fact_typed_relationships relation JOIN evidence_facts f ON f.id=relation.fact_id JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      typedSetAssertions:`${AUTHORIZED_ASSETS} SELECT assertion.* FROM evidence_fact_typed_set_assertions assertion JOIN evidence_facts f ON f.id=assertion.fact_id JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      derivations:`${AUTHORIZED_ASSETS} SELECT derivation.* FROM evidence_fact_derivations derivation JOIN evidence_facts f ON f.id=derivation.derived_fact_id JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      verifications:`${AUTHORIZED_ASSETS} SELECT verification.* FROM evidence_verification_attempts verification JOIN evidence_extraction_runs er ON er.id=verification.verification_extraction_run_id JOIN authorized_assets aa ON aa.id=er.asset_id`,
      interpretationOperations:`SELECT operation.id,operation.tenant_id,operation.context_id,operation.caller_scope,operation.status,operation.extraction_run_id,operation.failure_code,operation.started_at,operation.completed_at,operation.created_at,operation.updated_at FROM evidence_interpretation_operations operation WHERE operation.tenant_id=$1 AND operation.context_id=$2`,
      needEvaluationRuns:`SELECT run.*,r.context_id,r.subject_reference_id FROM evidence_need_evaluation_runs run JOIN evidence_requirement_information_needs n ON n.id=run.information_need_id JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
      factNeedEvaluations:`SELECT evaluation.* FROM evidence_fact_need_evaluations evaluation JOIN evidence_need_evaluation_runs run ON run.id=evaluation.evaluation_run_id JOIN evidence_requirement_information_needs n ON n.id=run.information_need_id JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
      coverageRuns:`SELECT run.*,r.context_id,r.subject_reference_id FROM evidence_coverage_assessment_runs run JOIN evidence_requirement_information_needs n ON n.id=run.information_need_id JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
      coverageCandidates:`SELECT candidate.* FROM evidence_coverage_assessment_candidates candidate JOIN evidence_coverage_assessment_runs run ON run.id=candidate.assessment_run_id JOIN evidence_requirement_information_needs n ON n.id=run.information_need_id JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
      coverageFindings:`SELECT finding.* FROM evidence_coverage_comparison_findings finding JOIN evidence_coverage_assessment_runs run ON run.id=finding.assessment_run_id JOIN evidence_requirement_information_needs n ON n.id=run.information_need_id JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id WHERE c.tenant_id=$1 AND c.id=$2`,
    };
    const names=Object.keys(queries),results=await Promise.all(names.map((name)=>this.db.query(queries[name],params)));
    return Object.fromEntries(names.map((name,index)=>[name,mapped(results[index])]));
  }
}

module.exports={MemoryA5aRepository,PostgresA5aRepository,mapRow};
