const { test } = require("node:test");
const assert = require("node:assert");
const { listTemplates, buildTemplateConfig } = require("../configTemplates");

test("listTemplates exposes the default settings template", () => {
  const ids = listTemplates().map((t) => t.id);
  assert.ok(ids.includes("default"));
  const entry = listTemplates().find((t) => t.id === "default");
  assert.strictEqual(typeof entry.label, "string");
  assert.ok(entry.label.length > 0);
});

test("buildTemplateConfig returns a brand-free config stamped for the tenant", () => {
  const cfg = buildTemplateConfig("default", "acme");
  assert.strictEqual(cfg._tenantId, "acme");
  assert.strictEqual(cfg._templateId, "default");
  assert.strictEqual(cfg.company.name, "");
  assert.strictEqual(cfg.company.manualFormUrl, "");
  assert.ok(cfg.licences.length >= 2, "keeps the reference licences");
  assert.ok(Object.keys(cfg.schemas).length >= 8, "keeps the reference schemas");
  // The whole config now, bookkeeping stamp included. This test used to carve
  // out `_templateId` because the template was called "nium-default" - the
  // carve-out was the brand leak wearing a note explaining itself.
  assert.doesNotMatch(JSON.stringify(cfg), /nium/i, "no brand reference may survive anywhere in a template");
});

test("the template's old name still resolves", () => {
  // "nium-default" travelled in URLs people bookmarked and in tenant records
  // already written. A rename that breaks those is an outage, not a rename.
  for (const legacy of ["nium-default", "nium-defaults"]) {
    const cfg = buildTemplateConfig(legacy, "acme");
    assert.ok(cfg, `${legacy} must still resolve`);
    assert.strictEqual(cfg._templateId, "default", "but it is stamped with the name it has now");
  }
});

test("an unknown template id returns null", () => {
  assert.strictEqual(buildTemplateConfig("does-not-exist", "acme"), null);
});
