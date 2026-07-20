// ── API pricing (Anthropic, June 2026) ──
// Unit prices used to calculate ACTUAL cost from REAL token counts. Token
// counts come from response.usage on every Anthropic API call — these are
// not estimates. Mirrors lib/persist.js#estimateCostUsd ($3 / $15 per Mtok)
// so the live submit path and the benchmark path price tokens identically.
export const API_PRICING = {
  model: "claude-sonnet-4-20250514",
  inputCostPerMillionTokens: 3.0, // USD
  outputCostPerMillionTokens: 15.0, // USD
};

// Calculate real dollar cost from real token counts returned by the API.
export function calcCostUsd(inputTokens, outputTokens) {
  return (
    (inputTokens / 1_000_000) * API_PRICING.inputCostPerMillionTokens +
    (outputTokens / 1_000_000) * API_PRICING.outputCostPerMillionTokens
  );
}

// Aggregate the per-phase costTracker into a single summary object for
// persistence. Totals are recomputed from summed REAL token counts (not from
// summing pre-rounded per-phase dollar figures) to avoid float drift.
export function buildCostSummary(tracker, company, entityType, ownershipType, coverage) {
  // Collect only phases that actually ran
  const phases = [
    tracker.docSearch,
    tracker.researchPass1,
    tracker.researchPass2,
    tracker.docExtraction,
  ].filter(Boolean);

  // Sum real token counts across all phases
  const totalInputTokens = phases.reduce(
    (sum, p) => sum + (p.inputTokens || 0),
    0
  );
  const totalOutputTokens = phases.reduce(
    (sum, p) => sum + (p.outputTokens || 0),
    0
  );
  // Recalculate total cost from tokens for accuracy (avoid float rounding
  // from summing pre-calculated per-phase costs)
  const totalCostUsd = calcCostUsd(totalInputTokens, totalOutputTokens);

  return {
    model: API_PRICING.model,
    pricingUsed: {
      inputCostPerMillionTokens: API_PRICING.inputCostPerMillionTokens,
      outputCostPerMillionTokens: API_PRICING.outputCostPerMillionTokens,
    },

    // Per-phase breakdown with real counts
    breakdown: {
      docSearch: tracker.docSearch,
      researchPass1: tracker.researchPass1,
      researchPass2: tracker.researchPass2,
      docExtraction: tracker.docExtraction,
    },

    // Totals across all phases
    totals: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd,
      apiCallCount: phases.reduce((sum, p) => sum + (p.apiCallCount || 1), 0),
      phasesRan: phases.length,
    },

    // Coverage context
    coverage: coverage
      ? {
          fillRate: coverage.fillRate,
          verifiedFillRate: coverage.verifiedFillRate,
          totalResearchFields: coverage.totalResearchFields,
          populatedFields: coverage.populatedFields,
          verifiedFields: coverage.verifiedFields,
          // Cost per field found
          costPerFieldUsd:
            coverage.populatedFields > 0
              ? totalCostUsd / coverage.populatedFields
              : null,
      }
      : null,

    computedAt: new Date().toISOString(),
  };
}
