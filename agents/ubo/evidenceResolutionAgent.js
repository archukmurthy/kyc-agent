"use strict";

// Selects the best-supported reported value; it deliberately does not average
// incompatible registry filings or let an LLM make a numerical decision.
function scoreEvidence(evidence, now = Date.now()) {
  const reliability = Math.max(0, Math.min(100, Number(evidence.sourceReliability) || 0));
  const extraction = Math.max(0, Math.min(100, Number(evidence.extractionConfidence) || 100));
  const jurisdiction = evidence.jurisdictionRelevant === false ? 40 : 100;
  const ageDays = evidence.publishedAt ? Math.max(0, (now - new Date(evidence.publishedAt).getTime()) / 86400000) : 365;
  const recency = Math.max(20, 100 - ageDays / 18.25); // decays to 20 over about four years
  return Math.round((reliability * 0.45) + (extraction * 0.25) + (jurisdiction * 0.15) + (recency * 0.15));
}

function resolveEvidence(candidates = []) {
  if (!candidates.length) return { resolvedValue: null, confidence: 0, explanation: ["No evidence was available."], evidenceIds: [] };
  const ranked = candidates.map((candidate) => ({ ...candidate, score: scoreEvidence(candidate) }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  return {
    resolvedValue: selected.value,
    confidence: selected.score,
    evidenceIds: selected.id ? [selected.id] : [],
    explanation: [
      `Selected ${selected.source || "the highest-ranked source"} (score ${selected.score}).`,
      ...ranked.slice(1).map((item) => `Did not select ${item.source || "an alternative source"} (score ${item.score}; reported ${item.value}).`),
    ],
  };
}

module.exports = { resolveEvidence, scoreEvidence };
