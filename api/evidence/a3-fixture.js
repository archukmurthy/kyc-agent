"use strict";

const { MemoryA3Repository } = require("../../evidence/a3/repository");
const { EvidenceA3Service } = require("../../evidence/a3/service");

module.exports = async function evidenceA3FixtureHandler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  try { return res.status(200).json(await new EvidenceA3Service(new MemoryA3Repository()).fixtureDemonstration()); }
  catch (error) { return res.status(500).json({ error: "A3 fixture demonstration failed", message: error.message }); }
};
