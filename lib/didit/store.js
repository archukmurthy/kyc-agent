"use strict";
const fs = require("node:fs");
const path = require("node:path");

function storePath() {
  return process.env.DIDIT_STORE_PATH || path.join(process.cwd(), ".didit-store.json");
}
function readAll() {
  try { return JSON.parse(fs.readFileSync(storePath(), "utf8")); }
  catch (_) { return {}; }
}
function writeAll(obj) {
  fs.writeFileSync(storePath(), JSON.stringify(obj, null, 2));
}
// ponytail: last-write-wins, non-atomic single-user dev store — swap for Neon / idv encrypted store (BACKLOG DEP-1 / IDV-1).
function merge(ref, patch) {
  const all = readAll();
  all[ref] = { ...(all[ref] || {}), ...patch, updatedAt: new Date().toISOString() };
  writeAll(all);
}
function saveSession(ref, { providerSessionId }) { merge(ref, { providerSessionId }); }
function getSession(ref) { return readAll()[ref] || null; }
function saveResult(ref, { status, verified, mappedFields, extras }) {
  merge(ref, { status, verified, mappedFields, extras });
}
function getResult(ref) { return readAll()[ref] || null; }
// edits = { [field]: { original, changed } }. Stored alongside the untouched
// original mappedFields/extras — the decision data is never overwritten.
function saveEdits(ref, edits) { merge(ref, { edits }); }

module.exports = { saveSession, getSession, saveResult, getResult, saveEdits };
