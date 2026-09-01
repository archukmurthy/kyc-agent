"use strict";

const path=require("node:path");
const {createPostgresDb}=require("../../evidence/a2/postgresDb");
const {PostgresA3Repository}=require("../../evidence/a3/repository");
const {EvidenceArtifactReader}=require("../../evidence/a3/artifactReader");
const {AnthropicSemanticProvider}=require("../../evidence/a3/providers");
const {LiveArtifactInterpretationService}=require("../../evidence/a3/liveService");
const {PostgresR2Repository,R2A3RepositoryAdapter}=require("../../evidence/r2/repository");
const {TargetedInterpretationService}=require("../../evidence/r2/service");

function create(){
  if(!process.env.DATABASE_URL)throw Object.assign(new Error("R2 requires DATABASE_URL and migrations through 015"),{code:"database_not_configured",statusCode:503});
  const db=createPostgresDb(),artifactRepository=new PostgresA3Repository(db),repository=new PostgresR2Repository(db),r2A3Repository=new R2A3RepositoryAdapter(artifactRepository);
  const provider=process.env.ANTHROPIC_API_KEY&&process.env.EVIDENCE_A3_ANTHROPIC_MODEL?new AnthropicSemanticProvider({apiKey:process.env.ANTHROPIC_API_KEY,model:process.env.EVIDENCE_A3_ANTHROPIC_MODEL}):null;
  const providerLineage=provider?provider.configuration():{provider:"anthropic",model:process.env.EVIDENCE_A3_ANTHROPIC_MODEL||null,instructionReference:"evidence-r4-live-v1-typed-relations"};
  const interpreter=new LiveArtifactInterpretationService({repository:r2A3Repository,artifactReader:new EvidenceArtifactReader({filesystemRoot:process.env.EVIDENCE_ARTIFACT_DIR?path.resolve(process.env.EVIDENCE_ARTIFACT_DIR):null}),provider,providerLineage});
  return{repository,artifactRepository,interpreter,service:new TargetedInterpretationService({repository,artifactRepository,interpreter}),close:()=>db.close()};
}

function authorization(req,body={}){
  if(req.evidenceAuthorization)return req.evidenceAuthorization;
  if(process.env.NODE_ENV==="production"||process.env.VERCEL)throw Object.assign(new Error("Trusted host Evidence authorization is required"),{code:"access_denied",statusCode:403});
  return{tenantId:process.env.EVIDENCE_LAB_TENANT_ID||process.env.TENANT_ID||"nium",contextId:body.contextId,callerScope:"evidence_lab:r2",actorType:"human",actorId:process.env.EVIDENCE_LAB_ACTOR_ID||"local-product-reviewer"};
}

module.exports={authorization,create};
