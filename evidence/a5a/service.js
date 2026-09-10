"use strict";

const {AVAILABILITY_RULES_VERSION,AVAILABILITY_RULES,LIMITATIONS,projectEvidence}=require("./domain");

function required(value,name){if(typeof value!=="string"||!value.trim())throw Object.assign(new Error(`${name} is required`),{code:"invalid_request"});return value.trim();}
function contextView(context){return{id:context.id,tenantId:context.tenantId,contextType:context.contextType,externalReference:context.externalContextReference,subjectReferenceId:context.subjectReferenceId,subjectDisplayName:context.displayName,subjectIdentifier:`${context.identifierScheme}: ${context.identifierValue}`,jurisdiction:context.jurisdiction,createdAt:context.createdAt};}

class EvidenceReconstructionService {
  constructor({repository,clock=()=>new Date()}){if(!repository)throw new Error("EvidenceReconstructionService requires repository");this.repository=repository;this.clock=clock;}
  async listOptions({authorizedTenant}){const tenantId=required(authorizedTenant,"authorizedTenant"),contexts=await this.repository.listContexts(tenantId);return{contexts:contexts.map(contextView),sideEffects:{sourceCall:false,providerCall:false,writes:false}};}
  async reconstructEvidence({authorizedTenant,authorizedContext,subject=null,asOf}){
    const tenantId=required(authorizedTenant,"authorizedTenant"),contextId=required(authorizedContext,"authorizedContext"),cutoff=new Date(asOf);
    if(!asOf||Number.isNaN(cutoff.getTime()))throw Object.assign(new Error("asOf must be a valid date/time"),{code:"invalid_as_of"});
    if(cutoff.getTime()>this.clock().getTime()+1000)throw Object.assign(new Error("asOf cannot be in the future"),{code:"future_as_of"});
    const context=await this.repository.authorizeContext(tenantId,contextId);
    if(!context)throw Object.assign(new Error("The current caller is not authorized for this Evidence context"),{code:"access_denied",statusCode:403});
    if(subject&&subject!==context.subjectReferenceId)throw Object.assign(new Error("The requested subject does not belong to the authorized Evidence context"),{code:"subject_context_mismatch",statusCode:403});
    const records=await this.repository.loadRecords({tenantId,contextId,subjectReferenceId:context.subjectReferenceId});
    const entries=projectEvidence(records,cutoff),counts={};for(const item of entries)counts[item.category]=(counts[item.category]||0)+1;
    return{stage:"A5a",projectionType:"transient_read_model",availabilityRulesVersion:AVAILABILITY_RULES_VERSION,availabilityRules:AVAILABILITY_RULES,asOf:cutoff.toISOString(),authorizedUsing:"current_access_state",context:contextView(context),subject:{id:context.subjectReferenceId,displayName:context.displayName,identifierScheme:context.identifierScheme,identifierValue:context.identifierValue,jurisdiction:context.jurisdiction},summary:{entryCount:entries.length,byCategory:counts},entries,limitations:[...LIMITATIONS],downstreamDecision:{kyc:"not_reconstructed",ubo:"not_reconstructed",qualification:"Not reconstructed unless separately integrated"},sideEffects:{sourceCall:false,providerCall:false,reinterpretation:false,evaluation:false,reassessment:false,writes:false}};
  }
}

module.exports={EvidenceReconstructionService};
