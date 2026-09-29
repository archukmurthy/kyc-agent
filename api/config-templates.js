// Named configuration templates for the admin "Apply default settings" action
// and for super-admin tenant creation.
//
// GET                       — list available templates (admin-authed)
// GET ?id=<templateId>      — build that template for the resolved tenant
//
// Admin-authed because a template response is configuration shaped: it is not
// secret, but it is not public surface either. CommonJS, mirroring api/config.js.

const storage = require("../lib/storage");
const tenantRegistry = require("../lib/tenantRegistry");
const adminAuth = require("../lib/adminAuth");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { listTemplates, buildTemplateConfig } = require("../lib/configTemplates");
const { applyCors } = require("../lib/routeAuth");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };


function authorizeAdmin(tenant, token) {
  // One implementation, in lib/adminAuth.js - this copy also compared the
  // shared password with `===`, which is not constant-time.
  return adminAuth.authorizeAdmin(tenant, token, { storage: _deps.storage });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tenant = getTenantIdFromRequest(req);
  if (!tenant) return res.status(400).json({ error: "tenant_required" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!(await authorizeAdmin(tenant, token))) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = (req.query && req.query.id) || "";
  if (!id) return res.status(200).json({ templates: listTemplates() });

  const config = buildTemplateConfig(id, tenant);
  if (!config) return res.status(404).json({ error: "template_not_found" });
  return res.status(200).json({ templateId: id, config });
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
