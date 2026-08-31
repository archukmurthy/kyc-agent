"use strict";
const {buildFixtureDemonstration}=require("../../evidence/a4a/fixtures");
module.exports=async function(req,res){if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}try{return res.status(200).json(await buildFixtureDemonstration());}catch(error){return res.status(500).json({error:"A4a fixture failed",message:error.message});}};
