"use strict";

const { createHash, randomUUID } = require("crypto");
const storage = require("../../lib/storage");

const CACHE_VERSION = "v1";
const CACHE_TTL = { resolved: 30 * 86400, partial: 7 * 86400, unresolved: 86400 };

function normalise(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function identity({ entityName, registrationNumber, jurisdiction }) {
  return createHash("sha256").update([normalise(entityName), normalise(registrationNumber), normalise(jurisdiction)].join("|")).digest("hex");
}
function resultKey(input, tenantId) { return `ubo:result:${CACHE_VERSION}:${normalise(tenantId || "demo")}:${identity(input)}`; }
function entityKey(entity, tenantId) { return `ubo:web:${CACHE_VERSION}:${normalise(tenantId || "demo")}:${identity({ entityName: entity.name, registrationNumber: entity.registrationNumber, jurisdiction: entity.jurisdiction })}`; }

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
  const id = randomUUID();
  await storage.set(`ubo:audit:${id}`, { id, createdAt: new Date().toISOString(), ...record });
  return id;
}

module.exports = { identity, resultKey, entityKey, getFresh, cacheResult, appendAudit, CACHE_TTL };
