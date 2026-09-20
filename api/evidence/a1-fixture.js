"use strict";

const { MemoryEvidenceRepository } = require("../../evidence/a1/repository");
const { EvidenceA1Service } = require("../../evidence/a1/service");

module.exports = async function evidenceA1FixtureHandler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const service = new EvidenceA1Service(new MemoryEvidenceRepository());
    return res.status(200).json(await service.persistFixtureDemonstration());
  } catch (error) {
    return res.status(500).json({ error: "A1 fixture demonstration failed", message: error.message });
  }
};
