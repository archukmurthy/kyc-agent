"use strict";
const { buildInsert } = require("../a1/repository");
const { validateEvaluationBundle } = require("./domain");
function rows(result) { return result?.rows || result || []; }
const RUN_COLUMNS = [["id","id"],["information_need_id","informationNeedId"],["evaluation_method","evaluationMethod"],["evaluator_name","evaluatorName"],["evaluator_version","evaluatorVersion"],["provider","provider"],["model_identifier","modelIdentifier"],["instruction_reference","instructionReference"],["evaluation_context","evaluationContext","jsonb"],["status","status"],["started_at","startedAt"],["completed_at","completedAt"],["evaluated_at","evaluatedAt"],["limitations","limitations","jsonb"],["error_code","errorCode"],["error_message","errorMessage"],["created_at","createdAt"]];
const EVALUATION_COLUMNS = [["id","id"],["evaluation_run_id","evaluationRunId"],["fact_id","factId"],["result","result"],["reason","reason"],["qualification","qualification","jsonb"],["comparison_inputs","comparisonInputs","jsonb"],["normalization_id","normalizationId"],["normalization_version","normalizationVersion"],["normalization_reference","normalizationReference"],["created_at","createdAt"]];
class MemoryA4aRepository {
  constructor({ needs = [], facts = [] } = {}) { this.needs = needs; this.facts = facts; this.bundles = []; }
  async resolveInputs({ informationNeedId, factIds, tenantId, contextId = null }) { const need = this.needs.find((x) => x.id === informationNeedId && x.tenantId === tenantId && (!contextId || x.contextId === contextId)); const facts = factIds.map((id) => this.facts.find((x) => x.id === id && x.tenantId === tenantId)).filter(Boolean); return { need, facts }; }
  async appendEvaluation(bundle) { validateEvaluationBundle(bundle); this.bundles.push(structuredClone(bundle)); return { runId: bundle.run.id }; }
  async listEvaluations({ informationNeedId }) { return this.bundles.filter((x) => x.run.informationNeedId === informationNeedId).flatMap((x) => [{ ...x.run, evaluations: x.evaluations }]); }
  async listSelectionOptions({ collectionId, tenantId }) { return { collection: { id: collectionId, subjectDisplayName: "Fixture company", subjectIdentifier: "fixture" }, needs: this.needs.filter((x) => x.tenantId === tenantId), facts: this.facts.filter((x) => x.tenantId === tenantId) }; }
}
class PostgresA4aRepository {
  constructor(db) { if (!db?.query) throw new Error("PostgresA4aRepository requires db.query"); this.db = db; }
  async resolveInputs({ informationNeedId, factIds, tenantId, contextId = null }) {
    const needResult = await this.db.query(`SELECT n.*, r.context_id, r.subject_reference_id, r.description AS requirement_description, c.tenant_id
      FROM evidence_requirement_information_needs n JOIN evidence_requirements r ON r.id=n.requirement_id JOIN evidence_contexts c ON c.id=r.context_id
      WHERE n.id=$1 AND c.tenant_id=$2 AND ($3::uuid IS NULL OR c.id=$3::uuid)`, [informationNeedId, tenantId, contextId]);
    const need = rows(needResult)[0]; if (!need) return { need: null, facts: [] };
    const factResult = await this.db.query(`SELECT f.*, a.subject_reference_id, a.access_class, ac.tenant_id, ac.context_id, ar.captured_at, er.started_at AS extraction_started_at, er.completed_at AS extraction_completed_at
      FROM evidence_facts f JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id JOIN evidence_artifacts ar ON ar.id=f.artifact_id JOIN evidence_assets a ON a.id=ar.asset_id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      WHERE f.id = ANY($1::uuid[]) AND a.subject_reference_id=$2 AND (a.access_class='public' OR (ac.tenant_id=$3 AND ac.context_id=$4::uuid))`, [factIds, need.subject_reference_id, tenantId, need.context_id]);
    return { need: { id: need.id, schemaReference: need.schema_reference, schemaVersionReference: need.schema_version_reference, schemaFieldId: need.schema_field_id, requirementId: need.requirement_id, requirementDescription: need.requirement_description, contextId: need.context_id, tenantId: need.tenant_id, subjectReferenceId: need.subject_reference_id }, facts: rows(factResult).map((f) => ({ id:f.id, extractionRunId:f.extraction_run_id, artifactId:f.artifact_id, semanticConceptId:f.semantic_concept_id, factValue:f.fact_value, requestStatus:f.request_status, groundingType:f.grounding_type, supportState:f.support_state, supportSignals:f.support_signals||{}, createdAt:f.created_at, capturedAt:f.captured_at, extractionStartedAt:f.extraction_started_at, extractionCompletedAt:f.extraction_completed_at, tenantId:f.tenant_id })) };
  }
  async appendEvaluation(bundle) { validateEvaluationBundle(bundle); if (!this.db.transaction) throw new Error("Evaluation persistence requires transaction-capable db"); return this.db.transaction(async (tx) => { const q=buildInsert("evidence_need_evaluation_runs",RUN_COLUMNS,bundle.run); await tx.query(q.text,q.params); for(const item of bundle.evaluations){const e=buildInsert("evidence_fact_need_evaluations",EVALUATION_COLUMNS,item);await tx.query(e.text,e.params);} return {runId:bundle.run.id}; }); }
  async listEvaluations({ informationNeedId, factIds = [], tenantId, contextId = null }) {
    const scoped = await this.resolveInputs({ informationNeedId, factIds: factIds.length?factIds:["00000000-0000-0000-0000-000000000000"], tenantId, contextId }); if(!scoped.need)return [];
    const result=await this.db.query(`SELECT r.*, COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'factId',e.fact_id,'result',e.result,'reason',e.reason,'qualification',e.qualification,'comparisonInputs',e.comparison_inputs,'normalizationId',e.normalization_id,'normalizationVersion',e.normalization_version,'normalizationReference',e.normalization_reference,'createdAt',e.created_at) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL),'[]'::jsonb) evaluations FROM evidence_need_evaluation_runs r LEFT JOIN evidence_fact_need_evaluations e ON e.evaluation_run_id=r.id WHERE r.information_need_id=$1 GROUP BY r.id ORDER BY r.created_at`,[informationNeedId]);
    return rows(result);
  }
  async listSelectionOptions({ collectionId, tenantId }) {
    const collectionResult = await this.db.query(`SELECT co.id, co.subject_reference_id, co.collection_coordinates, co.started_at, co.completed_at,
      s.display_name AS subject_display_name, s.identifier_value AS subject_identifier
      FROM evidence_collection_operations co JOIN evidence_subject_references s ON s.id=co.subject_reference_id
      WHERE co.id=$1 AND EXISTS (SELECT 1 FROM evidence_acquisitions ac WHERE ac.collection_operation_id=co.id AND ac.tenant_id=$2)`, [collectionId, tenantId]);
    const collection = rows(collectionResult)[0]; if (!collection) return null;
    const needResult = await this.db.query(`SELECT DISTINCT n.id, n.schema_field_id, n.schema_reference, n.schema_version_reference,
      n.tenant_config_version, n.created_at, r.id AS requirement_id, r.description AS requirement_description, r.context_id,
      c.context_type, c.external_context_reference
      FROM evidence_requirement_information_needs n JOIN evidence_requirements r ON r.id=n.requirement_id
      JOIN evidence_contexts c ON c.id=r.context_id JOIN evidence_acquisitions ac ON ac.context_id=c.id
      WHERE ac.collection_operation_id=$1 AND c.tenant_id=$2 ORDER BY n.schema_field_id`, [collectionId, tenantId]);
    const factResult = await this.db.query(`SELECT DISTINCT f.id, f.semantic_concept_id, f.fact_value, f.request_status, f.grounding_type,
      f.support_state, f.created_at, f.information_need_id, f.schema_field_id, er.started_at AS extraction_started_at,
      er.completed_at AS extraction_completed_at, ar.id AS artifact_id, ar.representation_type, ar.media_type, ar.captured_at,
      a.id AS asset_id, a.title AS asset_title, a.evidence_type, a.access_class, ac.source_provider, ac.source_type, ac.source_locator
      FROM evidence_facts f JOIN evidence_extraction_runs er ON er.id=f.extraction_run_id
      JOIN evidence_artifacts ar ON ar.id=f.artifact_id JOIN evidence_assets a ON a.id=ar.asset_id
      JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      WHERE a.subject_reference_id=$1 AND (a.access_class='public' OR (ac.tenant_id=$2 AND ac.context_id IN (
        SELECT DISTINCT scoped.context_id FROM evidence_acquisitions scoped WHERE scoped.collection_operation_id=$3 AND scoped.tenant_id=$2
      ))) ORDER BY f.created_at DESC, f.semantic_concept_id`, [collection.subject_reference_id, tenantId, collectionId]);
    return {
      collection: { id: collection.id, subjectDisplayName: collection.subject_display_name, subjectIdentifier: collection.subject_identifier, collectionCoordinates: collection.collection_coordinates, startedAt: collection.started_at, completedAt: collection.completed_at },
      needs: rows(needResult).map((n) => ({ id:n.id, schemaFieldId:n.schema_field_id, schemaReference:n.schema_reference, schemaVersionReference:n.schema_version_reference, tenantConfigVersion:n.tenant_config_version, requirementId:n.requirement_id, requirementDescription:n.requirement_description, contextId:n.context_id, contextType:n.context_type, contextReference:n.external_context_reference, createdAt:n.created_at, comparisonTargetAvailable:false, comparisonTarget:null })),
      facts: rows(factResult).map((f) => ({ id:f.id, semanticConceptId:f.semantic_concept_id, factValue:f.fact_value, requestStatus:f.request_status, groundingType:f.grounding_type, supportState:f.support_state, schemaFieldId:f.schema_field_id, informationNeedId:f.information_need_id, createdAt:f.created_at, extractionStartedAt:f.extraction_started_at, extractionCompletedAt:f.extraction_completed_at, artifact:{ id:f.artifact_id, representationType:f.representation_type, mediaType:f.media_type, capturedAt:f.captured_at }, asset:{ id:f.asset_id, title:f.asset_title, evidenceType:f.evidence_type, accessClass:f.access_class }, source:{ provider:f.source_provider, type:f.source_type, locator:f.source_locator } })),
    };
  }
}
module.exports={MemoryA4aRepository,PostgresA4aRepository,RUN_COLUMNS,EVALUATION_COLUMNS};
