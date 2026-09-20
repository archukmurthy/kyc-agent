"use strict";

const { artifactOrder, orderAndAssessInputs, mediaSupported } = require("../a3/liveService");
const { fingerprint, r2Error, randomUUID, validateAuthorization, validateRequest } = require("./domain");

function safeMessage(error) {
  const allowed = new Set(["unsupported_media_type","media_too_large","media_limit_exceeded","invalid_media","encrypted_media","unsupported_model_media","provider_media_rejected","provider_not_configured","provider_authentication_failed","provider_timeout","provider_unavailable","provider_failed","provider_malformed_output","provider_output_truncated","artifact_integrity_mismatch","artifact_storage_unavailable","no_supported_facts","database_persistence_failed"]);
  return allowed.has(error?.code) ? String(error.message || error.code).slice(0, 500) : "Targeted interpretation failed";
}
function publicTypedRelationship(relationship) {
  if (!relationship) return null;
  if (relationship.subject && relationship.object && relationship.value && relationship.mapping) return relationship;
  return {
    factId:relationship.factId,schemaVersion:relationship.relationshipSchemaVersion,relationshipType:relationship.relationshipType,
    subject:{partyType:relationship.subjectPartyType,...(relationship.subjectSnapshot||{})},object:{partyType:relationship.objectPartyType,...(relationship.objectSnapshot||{})},
    value:{kind:relationship.valueKind,measurementType:relationship.measurementType,exact:relationship.exactValue,lower:relationship.rangeLower,upper:relationship.rangeUpper,lowerInclusive:relationship.lowerInclusive,upperInclusive:relationship.upperInclusive,numerator:relationship.numerator,denominator:relationship.denominator,qualitative:relationship.qualitativeValue,unit:relationship.unit},
    temporal:{state:relationship.temporalState,effectiveFrom:relationship.effectiveFrom,effectiveTo:relationship.effectiveTo,sourceEffectiveDate:relationship.sourceEffectiveDate,precision:relationship.temporalPrecision||{}},
    sourceSpecificMetadata:relationship.sourceSpecificMetadata||{},qualifications:relationship.qualifications||[],mapping:{method:relationship.mappingMethod,id:relationship.mapperId,version:relationship.mapperVersion,reference:relationship.mapperReference},createdAt:relationship.createdAt,
  };
}
function publicFact(fact, requestedConcepts) {
  const responsive = requestedConcepts.some((item) => item.concept === fact.semanticConceptId);
  const persistedRequestStatus=fact.requestStatus==="requested"&&!fact.informationNeedId&&!fact.schemaFieldId?"discovered":fact.requestStatus;
  return { id:fact.id,semanticConceptId:fact.semanticConceptId,value:fact.factValue,requestRelation:responsive?"requested_concept_response":"open_discovery",persistedRequestStatus,groundingType:fact.groundingType,supportState:fact.supportState,supportingArtifactIds:fact.supportingArtifactIds||[fact.artifactId],supportLocators:fact.supportLocators||[],typedRelationship:publicTypedRelationship(fact.typedRelationship),createdAt:fact.createdAt };
}
function buildResult(operation, interpreted, request, completedAt) {
  const facts = [...(interpreted.requestedFacts||[]),...(interpreted.discoveredFacts||[])];
  const uniqueFacts = [...new Map(facts.map((fact) => [fact.id,fact])).values()].map((fact) => publicFact(fact,request.requestedConcepts));
  const responsive = uniqueFacts.filter((fact) => fact.requestRelation === "requested_concept_response");
  const discovered = uniqueFacts.filter((fact) => fact.requestRelation === "open_discovery");
  const outcomes = (interpreted.providerOutputEvaluation?.requestedConceptOutcomes||[]).map((item) => ({ concept:item.concept,status:item.status }));
  const completeness = { input:interpreted.providerOutputEvaluation?.inputCompleteness||null,extraction:interpreted.providerOutputEvaluation?.extractionCompleteness||null };
  return {
    operation:{ id:operation.id,key:operation.operationKey,status:"completed",outcome:completeness.input?.state==="incomplete"||completeness.extraction?.state==="incomplete"?"completed_partial":"completed",startedAt:operation.startedAt,completedAt },
    extractionRun:{ id:interpreted.extractionRun.id,status:interpreted.extractionRun.status,startedAt:interpreted.extractionRun.startedAt,completedAt:interpreted.extractionRun.completedAt,provider:interpreted.extractionRun.provider,model:interpreted.extractionRun.modelIdentifier,instructionReference:interpreted.extractionRun.instructionReference },
    evidence:{ assetId:interpreted.artifact.assetId,artifacts:(interpreted.artifacts||[interpreted.artifact]).map((artifact) => ({ id:artifact.id,assetId:artifact.assetId,representationType:artifact.representationType,mediaType:artifact.mediaType,sizeBytes:artifact.sizeBytes,capturedAt:artifact.capturedAt,order:artifact.order,inputRole:artifact.inputRole })),integrity:{ verified:interpreted.integrity?.verified===true,artifacts:interpreted.integrity?.artifacts||[] },mediaPreflight:interpreted.mediaPreflight||null },
    requestedConceptOutcomes:outcomes,
    responsiveFacts:responsive,
    discoveredFacts:discovered,
    completeness,
    limitations:[...new Set([...(completeness.input?.limitations||[]),...(completeness.extraction?.limitations||[])])],
    typedRelationshipCount:uniqueFacts.filter((fact)=>fact.typedRelationship).length,
    correlation:request.correlation,
    downstreamEvaluation:"not_performed",
  };
}

class TargetedInterpretationService {
  constructor({ repository, interpreter, artifactRepository = null, now = () => new Date().toISOString(), id = () => randomUUID() }) {
    if (!repository?.claimOperation || !repository?.completeOperation || !repository?.failOperation) throw new Error("R2 operation repository is required");
    if (!interpreter?.interpret) throw new Error("A3 interpretation service is required");
    this.repository=repository;this.interpreter=interpreter;this.artifactRepository=artifactRepository||interpreter.repository;this.now=now;this.id=id;
  }
  async resolve(request, authorization) {
    if (!this.artifactRepository?.findArtifactForInterpretation) throw new Error("R2 Artifact repository is required");
    const artifacts=[];
    for(const artifactId of request.artifactIds){const artifact=await this.artifactRepository.findArtifactForInterpretation({artifactId,tenantId:authorization.tenantId,contextId:authorization.contextId});if(!artifact)throw r2Error("artifact_not_found",`Artifact ${artifactId} was not found`,404);if(!artifact.authorized)throw r2Error("artifact_access_denied",`Artifact ${artifactId} is not authorized for this Evidence context`,403);artifacts.push(artifact);}
    if(new Set(artifacts.map((item)=>item.assetId)).size!==1)throw r2Error("cross_asset_interpretation_not_allowed","All Artifacts must belong to one Evidence Asset",409);
    return orderAndAssessInputs(artifacts).artifacts;
  }
  async interpret(input, trustedAuthorization) {
    const authorization=validateAuthorization(trustedAuthorization),request=validateRequest(input),artifacts=await this.resolve(request,authorization);
    const orderedIds=artifacts.map((item)=>item.id);
    const trustedCallerMetadata={actorType:authorization.actorType,actorId:authorization.actorId,callerScope:authorization.callerScope};
    const manifest={artifactIds:orderedIds,requestedConcepts:request.requestedConcepts,extractionContext:request.extractionContext,correlation:request.correlation,authorization:{tenantId:authorization.tenantId,contextId:authorization.contextId},trustedCallerMetadata};
    const requestFingerprint=fingerprint(manifest),startedAt=this.now();
    const claimed=await this.repository.claimOperation({id:this.id(),tenantId:authorization.tenantId,contextId:authorization.contextId,callerScope:authorization.callerScope,operationKey:request.operationKey,requestFingerprint,requestManifest:manifest,correlation:request.correlation,trustedCallerMetadata,startedAt});
    const operation=claimed.operation;
    if(!operation)throw r2Error("operation_persistence_failed","Interpretation operation could not be resolved",503);
    if(operation.requestFingerprint!==requestFingerprint)throw r2Error("idempotency_conflict","The operation key is already associated with a different canonical request",409,{operationId:operation.id});
    if(!claimed.created){
      if(operation.status==="completed")return{replayed:true,...operation.result};
      if(operation.status==="in_progress")return{replayed:true,operation:{id:operation.id,key:operation.operationKey,status:"in_progress",startedAt:operation.startedAt},correlation:operation.correlation};
      return{replayed:true,operation:{id:operation.id,key:operation.operationKey,status:"failed",startedAt:operation.startedAt,completedAt:operation.completedAt},failure:operation.failure,correlation:operation.correlation};
    }
    const unsupported=artifacts.find((item)=>!mediaSupported(item.mediaType));
    if(unsupported){
      const completedAt=this.now(),message=`Targeted interpretation does not support ${unsupported.mediaType||unsupported.representationType}`;
      await this.repository.failOperation(operation.id,{code:"unsupported_media_type",message,completedAt});
      return{operation:{id:operation.id,key:operation.operationKey,status:"failed",startedAt,completedAt},failure:{code:"unsupported_media_type",message},evidence:{assetId:unsupported.assetId,artifactIds:orderedIds},correlation:request.correlation,providerCalled:false};
    }
    try{
      const interpreted=await this.interpreter.interpret({artifactIds:orderedIds,tenantId:authorization.tenantId,contextId:authorization.contextId,requestedConcepts:request.requestedConcepts,extractionContext:{...request.extractionContext,contextSource:"r2_authorized_consumer"}});
      const completedAt=this.now(),result=buildResult(operation,interpreted,request,completedAt);
      await this.repository.completeOperation(operation.id,{extractionRunId:interpreted.extractionRun.id,result,completedAt});
      return{replayed:false,...result};
    }catch(error){
      const completedAt=this.now(),code=error.code||"interpretation_failed",message=safeMessage(error),extractionRunId=error.details?.runId||null;
      try{await this.repository.failOperation(operation.id,{code,message,extractionRunId,completedAt});}catch(_){}
      const noProviderCodes=new Set(["artifact_id_required","artifact_not_found","artifact_access_denied","artifact_integrity_mismatch","artifact_storage_unavailable","unsupported_media_type","media_too_large","media_limit_exceeded","invalid_media","encrypted_media","unsupported_model_media","provider_media_rejected","provider_not_configured"]);
      return{operation:{id:operation.id,key:operation.operationKey,status:"failed",startedAt,completedAt},failure:{code,message},correlation:request.correlation,providerCalled:!noProviderCodes.has(code)};
    }
  }
  async history({artifactIds=[]},trustedAuthorization){const authorization=validateAuthorization(trustedAuthorization);const ids=artifactIds.length?[...new Set(artifactIds.map(String))]:[];return{providerCalled:false,operations:await this.repository.listOperations({tenantId:authorization.tenantId,contextId:authorization.contextId,callerScope:authorization.callerScope,artifactIds:ids})};}
  async options({contextId=null},trustedAuthorization){const authorization=validateAuthorization(trustedAuthorization);if(contextId&&contextId!==authorization.contextId)throw r2Error("artifact_access_denied","The requested Evidence context does not match trusted host authorization",403);return{providerCalled:false,...await this.repository.listOptions({tenantId:authorization.tenantId,contextId:authorization.contextId})};}
  async preflight({artifactIds=[]},trustedAuthorization){const authorization=validateAuthorization(trustedAuthorization);if(!this.interpreter.preflight)throw r2Error("preflight_unavailable","Media preflight is unavailable",503);return this.interpreter.preflight({artifactIds,tenantId:authorization.tenantId,contextId:authorization.contextId});}
}

module.exports={TargetedInterpretationService,buildResult,publicFact,publicTypedRelationship,safeMessage};
