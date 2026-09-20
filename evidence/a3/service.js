"use strict";

const { buildA3FixtureBundle, summarizeA3 } = require("./fixtures");

class EvidenceA3Service {
  constructor(repository) { if (!repository || typeof repository.persistBundle !== "function") throw new Error("EvidenceA3Service requires repository"); this.repository = repository; }
  async fixtureDemonstration() { const bundle = await buildA3FixtureBundle(); const persistence = await this.repository.persistBundle(bundle); return { ...summarizeA3(bundle), persistence }; }
}

module.exports = { EvidenceA3Service };
