"use strict";
module.exports=function(req,res){if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}return res.status(200).json({stage:"A4a",database:!!process.env.DATABASE_URL,semanticProvider:!!(process.env.ANTHROPIC_API_KEY&&process.env.EVIDENCE_A4A_ANTHROPIC_MODEL),deterministic:true});};
