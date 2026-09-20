"use strict";

const { buildA1FixtureGraph, summarizeA1Fixture } = require("./fixtures");

class EvidenceA1Service {
  constructor(repository) {
    if (!repository || typeof repository.persistGraph !== "function") {
      throw new Error("EvidenceA1Service requires a repository");
    }
    this.repository = repository;
  }

  async persistFixtureDemonstration() {
    const graph = buildA1FixtureGraph();
    const persistence = await this.repository.persistGraph(graph);
    return { ...summarizeA1Fixture(graph), persistence };
  }
}

module.exports = { EvidenceA1Service };
