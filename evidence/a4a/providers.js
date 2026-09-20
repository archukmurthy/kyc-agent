"use strict";
const { parseProviderJson } = require("../a3/providers");
const { RESULTS } = require("./domain");
class NeedEvaluationProvider { async evaluate() { throw new Error("NeedEvaluationProvider.evaluate must be implemented"); } }
class FixtureNeedEvaluationProvider extends NeedEvaluationProvider { async evaluate({ fact, need }) { const related = fact.semanticConceptId === need.schemaFieldId || (fact.semanticConceptId === "registered_company_name" && need.schemaFieldId === "business_name"); return { result: related ? "addresses" : "does_not_address", reason: related ? "The source-supported Fact is semantically responsive to the Information Need." : "The Fact concerns a different concept.", qualification: {}, limitations: [] }; } }
class AnthropicNeedEvaluationProvider extends NeedEvaluationProvider {
  constructor({ apiKey, model, fetchImpl = global.fetch, instructionReference = "evidence-a4a-semantic-v1" } = {}) { super(); Object.assign(this, { apiKey, model, fetchImpl, instructionReference }); }
  configuration() { return { provider: "anthropic", model: this.model || null, instructionReference: this.instructionReference, ready: !!(this.apiKey && this.model) }; }
  async evaluate({ fact, need, comparisonInput, context }) {
    if (!this.apiKey || !this.model) throw Object.assign(new Error("Semantic evaluation requires ANTHROPIC_API_KEY and EVIDENCE_A4A_ANTHROPIC_MODEL"), { code: "provider_not_configured" });
    const prompt = ["Evaluate whether the supplied immutable Evidence Fact addresses the supplied existing Information Need.", `Return JSON only with result (${RESULTS.join(", ")}), reason, qualification, and limitations.`, "Do not decide final KYC satisfaction, truth, trust, source winner, operative value, matching, or requirement completion. Do not create facts, derivations, schema fields, or Information Needs.", `Information Need: ${JSON.stringify(need)}`, `Fact: ${JSON.stringify(fact)}`, `Explicit comparison input: ${JSON.stringify(comparisonInput || null)}`, `Evaluation context: ${JSON.stringify(context || {})}`].join("\n\n");
    let response; try { response = await this.fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: this.model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }) }); } catch (_) { throw Object.assign(new Error("Evaluation provider request failed"), { code: "provider_unavailable" }); }
    if (!response.ok) throw Object.assign(new Error(`Evaluation provider failed with HTTP ${response.status}`), { code: "provider_failed" });
    const payload = await response.json(); const parsed = parseProviderJson((payload.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n"));
    if (!RESULTS.includes(parsed.result) || !parsed.reason) throw Object.assign(new Error("Evaluation provider returned an invalid conclusion"), { code: "provider_malformed_output" });
    return { result: parsed.result, reason: String(parsed.reason), qualification: parsed.qualification || {}, limitations: Array.isArray(parsed.limitations) ? parsed.limitations.map(String) : [] };
  }
}
module.exports = { AnthropicNeedEvaluationProvider, FixtureNeedEvaluationProvider, NeedEvaluationProvider };
