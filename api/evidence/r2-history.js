"use strict";
const defaults=require("./r2-dependencies");
function createHandler(factory=defaults.create){return async(req,res)=>{if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}let d;try{d=await factory(req.body||{});const result=await d.service.history({artifactIds:req.body?.artifactIds||[]},defaults.authorization(req,req.body||{}));return res.status(200).json({success:true,result});}catch(e){return res.status(e.statusCode||500).json({error:"R2 interpretation history failed",code:e.code||"r2_history_failed",message:e.message});}finally{if(d?.close)await d.close();}};}
const h=createHandler();h.createHandler=createHandler;module.exports=h;
