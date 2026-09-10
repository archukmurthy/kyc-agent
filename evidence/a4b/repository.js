"use strict";

const { buildInsert } = require("../a1/repository");
const { validateAssessmentBundle } = require("./domain");
function rows(result) { return result?.rows || result || []; }

const RUN_COLUMNS = [["id","id"],["information_need_id","informationNeedId"],["specification_version","specificationVersion"],["specification_snapshot","specificationSnapshot","jsonb"],["comparator_profile","comparatorProfile"],["comparator_version","comparatorVersion"],["assessed_at","assessedAt"],["coverage_state","coverageState"],["completeness_state","completenessState"],["disagreement_state","disagreementState"],["temporal_state","temporalState"],["empty_set_state","emptySetState"],["input_sufficiency","inputSufficiency"],["reason_codes","reasonCodes","jsonb"],["limitations","limitations","jsonb"],["created_at","createdAt"]];
const CANDIDATE_COLUMNS = [["id","id"],["assessment_run_id","assessmentRunId"],["a4a_evaluation_id","a4aEvaluationId"],["fact_id","factId"],["contribution_role","contributionRole"],["evaluation_result","evaluationResult"],["reason_codes","reasonCodes","jsonb"],["created_at","createdAt"]];
const FINDING_COLUMNS = [["id","id"],["assessment_run_id","assessmentRunId"],["evaluation_a_id","evaluationAId"],["fact_a_id","factAId"],["evaluation_b_id","evaluationBId"],["fact_b_id","factBId"],["comparator_id","comparatorId"],["comparator_version","comparatorVersion"],["comparable","comparable"],["relationship","relationship"],["reason_code","reasonCode"],["comparison_basis","comparisonBasis","jsonb"],["created_at","createdAt"]];

class MemoryA4bRepository {
  constructor({ needs = [], evaluations = [], facts = [], typedRelationships = [], typedSetAssertions = [] } = {}) { this.needs=needs; this.evaluations=evaluations; this.facts=facts; this.typedRelationships=typedRelationships; this.typedSetAssertions=typedSetAssertions; this.bundles=[]; this.requirementMutations=0; }
  async resolveAssessmentInputs({ informationNeedId, candidates, tenantId, contextId = null }) {
    const need=this.needs.find((x)=>x.id===informationNeedId&&x.tenantId===tenantId&&(!contextId||x.contextId===contextId)); if(!need)return{need:null,candidates:[]};
    const resolved=[]; for(const requested of candidates){const evaluation=this.evaluations.find((x)=>x.id===requested.evaluationId&&x.factId===requested.factId&&x.informationNeedId===informationNeedId);const fact=this.facts.find((x)=>x.id===requested.factId&&x.tenantId===tenantId);if(evaluation&&fact)resolved.push({...fact,evaluation,typedRelationship:this.typedRelationships.find((x)=>x.factId===fact.id)||null,typedSetAssertion:this.typedSetAssertions.find((x)=>x.factId===fact.id)||null});}
    return{need,resolvedCandidates:resolved};
  }
  async appendAssessment(bundle){validateAssessmentBundle(bundle);this.bundles.push(structuredClone(bundle));return{runId:bundle.run.id};}
  async listAssessments({informationNeedId}){return this.bundles.filter((x)=>x.run.informationNeedId===informationNeedId).map((x)=>structuredClone(x));}
  async listAssessmentOptions({informationNeedId,tenantId}){const need=this.needs.find((x)=>x.id===informationNeedId&&x.tenantId===tenantId);return need?{need,candidates:this.evaluations.filter((x)=>x.informationNeedId===informationNeedId).map((evaluation)=>({evaluation,fact:this.facts.find((f)=>f.id===evaluation.factId)})).filter((x)=>x.fact)}:null;}
}

class PostgresA4bRepository {
  constructor(db){if(!db?.query)throw new Error("PostgresA4bRepository requires db.query");this.db=db;}
  async resolveAssessmentInputs({informationNeedId,candidates,tenantId,contextId=null}){
    const needResult=await this.db.query(`SELECT n.*,r.context_id,r.subject_reference_id,r.description AS requirement_description,c.tenant_id
      FROM evidence_requirement_information_needs n JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id
      WHERE n.id=$1 AND c.tenant_id=$2 AND ($3::uuid IS NULL OR c.id=$3::uuid)`,[informationNeedId,tenantId,contextId]);
    const rawNeed=rows(needResult)[0];if(!rawNeed)return{need:null,resolvedCandidates:[]};
    const evaluationIds=candidates.map((x)=>x.evaluationId),factIds=candidates.map((x)=>x.factId);
    const result=await this.db.query(`SELECT ev.id AS evaluation_id,ev.evaluation_run_id,ev.fact_id,ev.result AS evaluation_result,ev.reason AS evaluation_reason,ev.qualification,ev.comparison_inputs,
      f.semantic_concept_id,f.fact_value,f.request_status,f.grounding_type,f.support_state,f.created_at AS fact_created_at,
      a.subject_reference_id,a.access_class,ac.tenant_id,ac.context_id,ac.source_provider,ac.source_type,ac.source_locator,
      tr.relationship_schema_version,tr.relationship_type,tr.subject_party_type,tr.subject_snapshot,tr.object_party_type,tr.object_snapshot,tr.value_kind,tr.measurement_type,tr.exact_value::float8,tr.range_lower::float8,tr.range_upper::float8,tr.lower_inclusive,tr.upper_inclusive,tr.numerator::float8,tr.denominator::float8,tr.qualitative_value,tr.unit,tr.temporal_state AS relationship_temporal_state,tr.effective_from AS relationship_effective_from,tr.effective_to AS relationship_effective_to,
      sa.assertion_schema_version,sa.set_concept,sa.empty_state,sa.completeness_state AS assertion_completeness_state,sa.explicit_member_count,sa.temporal_state AS assertion_temporal_state,sa.effective_from AS assertion_effective_from,sa.effective_to AS assertion_effective_to,sa.source_effective_date AS assertion_source_effective_date
      FROM evidence_fact_need_evaluations ev JOIN evidence_need_evaluation_runs run ON run.id=ev.evaluation_run_id
      JOIN evidence_facts f ON f.id=ev.fact_id JOIN evidence_artifacts ar ON ar.id=f.artifact_id JOIN evidence_assets a ON a.id=ar.asset_id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      LEFT JOIN evidence_fact_typed_relationships tr ON tr.fact_id=f.id LEFT JOIN evidence_fact_typed_set_assertions sa ON sa.fact_id=f.id
      WHERE ev.id=ANY($1::uuid[]) AND ev.fact_id=ANY($2::uuid[]) AND run.information_need_id=$3 AND a.subject_reference_id=$4
      AND (a.access_class='public' OR (ac.tenant_id=$5 AND ac.context_id=$6::uuid))`,[evaluationIds,factIds,informationNeedId,rawNeed.subject_reference_id,tenantId,rawNeed.context_id]);
    const byPair=new Map(rows(result).map((row)=>[`${row.evaluation_id}:${row.fact_id}`,row]));
    const resolvedCandidates=candidates.map((requested)=>byPair.get(`${requested.evaluationId}:${requested.factId}`)).filter(Boolean).map(mapCandidate);
    return{need:{id:rawNeed.id,schemaFieldId:rawNeed.schema_field_id,schemaReference:rawNeed.schema_reference,schemaVersionReference:rawNeed.schema_version_reference,requirementId:rawNeed.requirement_id,requirementDescription:rawNeed.requirement_description,contextId:rawNeed.context_id,subjectReferenceId:rawNeed.subject_reference_id,tenantId:rawNeed.tenant_id},resolvedCandidates};
  }
  async appendAssessment(bundle){validateAssessmentBundle(bundle);if(!this.db.transaction)throw new Error("Assessment persistence requires transaction-capable db");return this.db.transaction(async(tx)=>{for(const [table,columns,items] of [["evidence_coverage_assessment_runs",RUN_COLUMNS,[bundle.run]],["evidence_coverage_assessment_candidates",CANDIDATE_COLUMNS,bundle.candidates],["evidence_coverage_comparison_findings",FINDING_COLUMNS,bundle.findings]])for(const item of items){const query=buildInsert(table,columns,item);await tx.query(query.text,query.params);}return{runId:bundle.run.id};});}
  async listAssessments({informationNeedId,tenantId,contextId=null}){
    const scoped=await this.resolveAssessmentInputs({informationNeedId,candidates:[],tenantId,contextId});if(!scoped.need)return[];
    const runResult=await this.db.query(`SELECT * FROM evidence_coverage_assessment_runs WHERE information_need_id=$1 ORDER BY created_at`,[informationNeedId]);
    const ids=rows(runResult).map((x)=>x.id);if(!ids.length)return[];
    const candidates=rows(await this.db.query(`SELECT c.*,f.semantic_concept_id,f.fact_value,f.request_status,f.grounding_type,f.support_state,ev.reason AS a4a_reason FROM evidence_coverage_assessment_candidates c JOIN evidence_facts f ON f.id=c.fact_id JOIN evidence_fact_need_evaluations ev ON ev.id=c.a4a_evaluation_id WHERE c.assessment_run_id=ANY($1::uuid[]) ORDER BY c.created_at`,[ids]));
    const findings=rows(await this.db.query(`SELECT * FROM evidence_coverage_comparison_findings WHERE assessment_run_id=ANY($1::uuid[]) ORDER BY created_at`,[ids]));
    return rows(runResult).map((run)=>({run,candidates:candidates.filter((x)=>x.assessment_run_id===run.id),findings:findings.filter((x)=>x.assessment_run_id===run.id)}));
  }
  async listAssessmentOptions({informationNeedId,tenantId,contextId=null}){
    const scoped=await this.resolveAssessmentInputs({informationNeedId,candidates:[],tenantId,contextId});if(!scoped.need)return null;
    const result=await this.db.query(`SELECT ev.id AS evaluation_id,ev.fact_id,ev.result AS evaluation_result,ev.reason AS evaluation_reason,ev.created_at AS evaluated_at,f.semantic_concept_id,f.fact_value,f.request_status,f.grounding_type,f.support_state,a.title AS asset_title,ar.media_type,ac.source_provider
      FROM evidence_fact_need_evaluations ev JOIN evidence_need_evaluation_runs run ON run.id=ev.evaluation_run_id JOIN evidence_facts f ON f.id=ev.fact_id JOIN evidence_artifacts ar ON ar.id=f.artifact_id JOIN evidence_assets a ON a.id=ar.asset_id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      WHERE run.information_need_id=$1 AND a.subject_reference_id=$2 AND (a.access_class='public' OR (ac.tenant_id=$3 AND ac.context_id=$4)) ORDER BY ev.created_at DESC`,[informationNeedId,scoped.need.subjectReferenceId,tenantId,scoped.need.contextId]);
    return{need:scoped.need,candidates:rows(result).map((row)=>({evaluation:{id:row.evaluation_id,factId:row.fact_id,result:row.evaluation_result,reason:row.evaluation_reason,evaluatedAt:row.evaluated_at},fact:{id:row.fact_id,semanticConceptId:row.semantic_concept_id,factValue:row.fact_value,requestStatus:row.request_status,groundingType:row.grounding_type,supportState:row.support_state,assetTitle:row.asset_title,mediaType:row.media_type,sourceProvider:row.source_provider}}))};
  }
}

function mapCandidate(row){
  const typedRelationship=row.relationship_type?{factId:row.fact_id,relationshipType:row.relationship_type,subjectSnapshot:row.subject_snapshot,objectSnapshot:row.object_snapshot,valueKind:row.value_kind,measurementType:row.measurement_type,exactValue:row.exact_value,rangeLower:row.range_lower,rangeUpper:row.range_upper,lowerInclusive:row.lower_inclusive,upperInclusive:row.upper_inclusive,numerator:row.numerator,denominator:row.denominator,qualitativeValue:row.qualitative_value,unit:row.unit,temporalState:row.relationship_temporal_state,effectiveFrom:row.relationship_effective_from,effectiveTo:row.relationship_effective_to}:null;
  const typedSetAssertion=row.assertion_schema_version?{factId:row.fact_id,setConcept:row.set_concept,emptyState:row.empty_state,completenessState:row.assertion_completeness_state,explicitMemberCount:row.explicit_member_count,temporalState:row.assertion_temporal_state,effectiveFrom:row.assertion_effective_from,effectiveTo:row.assertion_effective_to,sourceEffectiveDate:row.assertion_source_effective_date}:null;
  return{id:row.fact_id,factValue:row.fact_value,semanticConceptId:row.semantic_concept_id,requestStatus:row.request_status,groundingType:row.grounding_type,supportState:row.support_state,createdAt:row.fact_created_at,source:{provider:row.source_provider,type:row.source_type,locator:row.source_locator},evaluation:{id:row.evaluation_id,runId:row.evaluation_run_id,factId:row.fact_id,result:row.evaluation_result,reason:row.evaluation_reason,qualification:row.qualification,comparisonInputs:row.comparison_inputs},typedRelationship,typedSetAssertion};
}

module.exports={CANDIDATE_COLUMNS,FINDING_COLUMNS,MemoryA4bRepository,PostgresA4bRepository,RUN_COLUMNS,mapCandidate};
