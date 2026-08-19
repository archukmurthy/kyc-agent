"use strict";

const path = require("node:path");
const { createPostgresDb } = require("../../evidence/a2/postgresDb");
const { PostgresA2Repository } = require("../../evidence/a2/repository");
const { EvidenceCollectionHistoryService } = require("../../evidence/a2/historyService");
const { EvidenceArtifactReader } = require("../../evidence/a3/artifactReader");

function dependencies() { if (!process.env.DATABASE_URL) throw new Error("Existing Evidence lookup requires DATABASE_URL and migrations 010-011"); const db=createPostgresDb(); return { repository:new PostgresA2Repository(db), artifactReader:new EvidenceArtifactReader({filesystemRoot:process.env.EVIDENCE_ARTIFACT_DIR?path.resolve(process.env.EVIDENCE_ARTIFACT_DIR):null}), close:()=>db.close() }; }
function createHandler(dependencyFactory=dependencies) { return async function evidenceA2ExistingHandler(req,res) { if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});} let deps; try { deps=await dependencyFactory(req.body||{}); const result=await new EvidenceCollectionHistoryService(deps.repository,{artifactReader:deps.artifactReader}).findLatestCompaniesHouse({jurisdiction:req.body?.jurisdiction,companyNumber:req.body?.companyNumber}); return res.status(200).json(result); } catch(error){return res.status(400).json({error:"Existing Evidence lookup failed",message:error.message});} finally {if(deps?.close)await deps.close();} }; }
const handler=createHandler(); handler.createHandler=createHandler; module.exports=handler;
