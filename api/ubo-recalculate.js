"use strict";

const { recalculateOwnership } = require("../agents/ubo/realTimeRecalculationEngine");
const { applyCors, requireAdmin } = require("../lib/routeAuth");

// Standalone, no-search endpoint for document-upload/manual-entry events.
module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  // Batch 0: this route had no credential check. It is an internal tool with no caller in the app.
  if (!(await requireAdmin(req, res))) return undefined;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rootEntity, currentGraph, evidence, rules } = req.body || {};
  if (!rootEntity?.name || !rootEntity?.jurisdiction) return res.status(400).json({ error: "rootEntity.name and rootEntity.jurisdiction are required" });
  try { return res.status(200).json(recalculateOwnership({ rootEntity, currentGraph, evidence, rules })); }
  catch (error) { return res.status(400).json({ error: error.message }); }
};
