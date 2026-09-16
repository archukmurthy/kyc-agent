// Named configuration templates.
//
// A template is reference configuration a tenant can START FROM (at creation,
// via super-admin, or later via the admin "Apply default settings" action).
// Templates live in code, so they cannot be deleted at runtime — that is the
// point: the platform must always have something to seed from.
//
// Brand fields are CLEARED here. The reference data (licences, entity types,
// schemas, source tiers, documents) is generic; the company name and the
// manual application form URL belong to whoever applies the template.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const { buildDefaultConfig } = require("./seedConfig");

const TEMPLATES = [
  {
    id: "nium-default",
    label: "Nium default settings",
    description: "UK + Singapore licences, four entity types and the reference schemas, source tiers and document sets.",
    build: buildDefaultConfig,
  },
];

function listTemplates() {
  return TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));
}

function buildTemplateConfig(templateId, tenantId) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  const config = template.build(tenantId);
  config._tenantId = tenantId;
  config._templateId = template.id;
  config._isDefault = false;
  config._isBlank = false;
  config.company = {
    ...(config.company || {}),
    name: "",
    logo: null,
    manualFormUrl: "",
  };
  return config;
}

module.exports = { listTemplates, buildTemplateConfig };
