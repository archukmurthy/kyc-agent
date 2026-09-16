const { test } = require("node:test");
const assert = require("node:assert");
const { listTemplates, buildTemplateConfig } = require("../configTemplates");

test("listTemplates exposes the default settings template", () => {
  const ids = listTemplates().map((t) => t.id);
  assert.ok(ids.includes("nium-default"));
  const entry = listTemplates().find((t) => t.id === "nium-default");
  assert.strictEqual(typeof entry.label, "string");
  assert.ok(entry.label.length > 0);
});

test("buildTemplateConfig returns a brand-free config stamped for the tenant", () => {
  const cfg = buildTemplateConfig("nium-default", "acme");
  assert.strictEqual(cfg._tenantId, "acme");
  assert.strictEqual(cfg._templateId, "nium-default");
  assert.strictEqual(cfg.company.name, "");
  assert.strictEqual(cfg.company.manualFormUrl, "");
  assert.ok(cfg.licences.length >= 2, "keeps the reference licences");
  assert.ok(Object.keys(cfg.schemas).length >= 8, "keeps the reference schemas");
  const serialised = JSON.stringify(cfg);
  assert.doesNotMatch(serialised, /nium\.com/i, "no Nium URLs may survive");
});

test("an unknown template id returns null", () => {
  assert.strictEqual(buildTemplateConfig("does-not-exist", "acme"), null);
});
