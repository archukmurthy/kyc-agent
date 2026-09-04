"use strict";
const {createPostgresDb}=require("../../evidence/a2/postgresDb");const {PostgresA5aRepository}=require("../../evidence/a5a/repository");
function create(){if(process.env.NODE_ENV==="production"||process.env.VERCEL)throw Object.assign(new Error("A5a Evidence Lab routes are local-only; production consumers must call the server-side reconstruction service with trusted authorization context"),{statusCode:403,code:"access_denied"});if(!process.env.DATABASE_URL)throw Object.assign(new Error("A5a requires DATABASE_URL and migrations through 018"),{statusCode:503,code:"evidence_persistence_unavailable"});const db=createPostgresDb();return{repository:new PostgresA5aRepository(db),close:()=>db.close()};}
const tenant=()=>process.env.EVIDENCE_LAB_TENANT_ID||process.env.TENANT_ID||"nium";
module.exports={create,tenant};
