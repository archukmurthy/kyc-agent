"use strict";

const { createHash, randomUUID } = require("crypto");
const storage = require("../../lib/storage");

const CACHE_VERSION = "v1";
const CACHE_TTL = { resolved: 30 * 86400, partial: 7 * 86400, unresolved: 86400 };

function normalise(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function identity({ entityName, registrationNumber, jurisdiction }) {
  return createHash("sha256").update([normalise(entityName), normalise(registrationNumber), normalise(jurisdiction)].join("|")).digest("hex");
}
// A cache key with no workspace in it is a key SHARED between customers: one
// company would read another's research back out of it. Refuse rather than
// substitute a name - a default here is not a safety net, it is a silent leak.
function requireTenant(tenantId) {
  const named = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!named) throw new Error("a UBO cache key needs a workspace - callers must name one");
  return named;
}

function resultKey(input, tenantId) { return `ubo:result:${CACHE_VERSION}:${normalise(requireTenant(tenantId))}:${identity(input)}`; }
function entityKey(entity, tenantId) { return `ubo:web:${CACHE_VERSION}:${normalise(requireTenant(tenantId))}:${identity({ entityName: entity.name, registrationNumber: entity.registrationNumber, jurisdiction: entity.jurisdiction })}`; }

async function getFresh(key) {
  const record = await storage.get(key);
  if (!record || !record.expiresAt || new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record;
}
async function cacheResult(input, tenantId, result) {
  const ttlSeconds = CACHE_TTL[result.status] || CACHE_TTL.partial;
  const cachedAt = new Date().toISOString();
  const record = { result, cachedAt, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(), ttlSeconds };
  await storage.set(resultKey(input, tenantId), record, { ttlSeconds });
  return record;
}
async function appendAudit(record) {
  // Immutable, retrieval-oriented audit snapshots. KV/Redis gives this durable
  // storage in deployment; filesystem supports local development only.
  const id = record.id || randomUUID();
  await storage.set(`ubo:audit:${id}`, { id, createdAt: new Date().toISOString(), ...record });
  return id;
}

/** Everything stored here for one workspace - its cached research and its
 *  audit snapshots - for when a non-buyer's trial is deleted (lib/uboTrialPurge.js).
 *  ponytail: scans every audit key, since they are keyed by id rather than by
 *  workspace; fine at demo scale, key them by workspace if it grows. */
async function forgetTenant(tenantId, store = storage) {
  const workspace = normalise(requireTenant(tenantId));
  let removed = 0;
  for (const prefix of [`ubo:result:${CACHE_VERSION}:${workspace}:`, `ubo:web:${CACHE_VERSION}:${workspace}:`]) {
    for (const key of await store.list(prefix)) { await store.del(key); removed += 1; }
  }
  for (const key of await store.list("ubo:audit:")) {
    const record = await store.get(key);
    if (record && normalise(record.tenantId) === workspace) { await store.del(key); removed += 1; }
  }
  return removed;
}

module.exports = { identity, resultKey, entityKey, getFresh, cacheResult, appendAudit, forgetTenant, CACHE_TTL };
