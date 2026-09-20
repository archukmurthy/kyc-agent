"use strict";
const {createPostgresDb}=require("../../evidence/a2/postgresDb");
const {PostgresA5aRepository}=require("../../evidence/a5a/repository");
const {EvidenceReconstructionService}=require("../../evidence/a5a/service");
const {PostgresA5bRepository}=require("../../evidence/a5b/repository");
function create(){if(process.env.NODE_ENV==="production"||process.env.VERCEL)throw Object.assign(new Error("A5b Evidence Lab routes are local-only; production callers must use trusted server-side authorization"),{statusCode:403,code:"package_access_denied"});if(!process.env.DATABASE_URL)throw Object.assign(new Error("A5b requires DATABASE_URL and migrations through 019"),{statusCode:503,code:"evidence_persistence_unavailable"});const db=createPostgresDb(),a5aRepository=new PostgresA5aRepository(db);return{repository:new PostgresA5bRepository(db),reconstructionService:new EvidenceReconstructionService({repository:a5aRepository}),close:()=>db.close()};}
const trusted=()=>({tenantId:process.env.EVIDENCE_LAB_TENANT_ID||process.env.TENANT_ID||"nium",callerScope:"evidence_lab",actor:{type:"product_owner",id:"evidence_lab"}});
module.exports={create,trusted};
