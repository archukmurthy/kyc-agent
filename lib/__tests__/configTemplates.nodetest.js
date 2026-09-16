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
  // Check the tenant-facing content (company, licences, entityTypes, schemas, ...)
  // for brand leaks, not the `_templateId` bookkeeping stamp: that field is this
  // template's own stable name (asserted above and depended on by
  // api/tenants.js's startFrom matching) and is expected to read "nium-default".
  const { _templateId, ...content } = cfg;
  const serialised = JSON.stringify(content);
  assert.doesNotMatch(serialised, /nium/i, "no brand references may survive in the tenant-facing template content");
});

test("an unknown template id returns null", () => {
  assert.strictEqual(buildTemplateConfig("does-not-exist", "acme"), null);
});
