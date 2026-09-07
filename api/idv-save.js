"use strict";
const store = require("../lib/didit/store");

// Persist user corrections to the verified data WITHOUT overwriting the
// original decision. For each changed field we record { original, changed };
// unchanged fields are omitted. Original mappedFields/extras stay intact.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const ref = req.body && req.body.ref;
  const edits = (req.body && req.body.edits) || {};
  if (!ref) return res.status(400).json({ error: "ref_required" });
  const record = store.getResult(ref);
  if (!record) return res.status(404).json({ error: "session_not_found" });

  const original = { ...(record.mappedFields || {}), ...(record.extras || {}) };
  const changes = {};
  for (const [field, value] of Object.entries(edits)) {
    const orig = original[field];
    const origStr = orig == null ? "" : String(orig);
    if (String(value) !== origStr) {
      changes[field] = { original: orig == null ? null : orig, changed: value };
    }
  }
  store.saveEdits(ref, changes);
  return res.status(200).json({ edits: changes });
};
