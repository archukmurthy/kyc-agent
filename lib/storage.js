// Config storage layer with three backends, tried in priority order:
//
// 1. @vercel/kv REST — used when KV_REST_API_URL/TOKEN or
//    UPSTASH_REDIS_REST_URL/TOKEN are present (HTTP REST; best for serverless).
// 2. ioredis over TCP — used when only a REDIS_URL (rediss:// connection
//    string) is injected, which is what some Vercel/Marketplace Redis
//    integrations provide instead of REST credentials.
// 3. Filesystem — fallback for local dev and Vercel deployments without any
//    Redis provisioned. Single JSON document; repo root in dev, /tmp on Vercel
//    (ephemeral — reset on each deploy).
//
// Callers use get(key) / set(key, value, opts?) / list(prefix) / del(key).
// Values are arbitrary JSON-serialisable objects. The REST and filesystem
// backends store them as-is; the ioredis backend JSON-encodes them.

const fs = require("fs");
const path = require("path");

let kvClient = null;     // @vercel/kv REST client
let redisClient = null;  // ioredis TCP client
let backendName = "filesystem";

// ── Backend 1: KV REST (Upstash REST / Vercel KV) ──
try {
  // Accept either the legacy Vercel KV env names or the Upstash-for-Redis
  // marketplace names. Resolving both means provisioning "just works"
  // regardless of which integration created the database.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  // Guard against placeholder values so unprovisioned local dev quietly falls
  // back instead of crashing on an unparseable URL.
  if (url && token && /^https:\/\//i.test(url)) {
    // eslint-disable-next-line global-require
    const { createClient } = require("@vercel/kv");
    kvClient = createClient({ url, token });
    backendName = "kv";
  }
} catch (_) {
  // @vercel/kv not installed / unavailable — fall through.
}

// ── Backend 2: Redis over TCP (REDIS_URL connection string) ──
// Some Redis integrations inject only a redis://-style connection string and
// no REST credentials. ioredis speaks that protocol directly (TLS is inferred
// from the rediss:// scheme).
if (!kvClient) {
  try {
    const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
    if (redisUrl && /^rediss?:\/\//i.test(redisUrl)) {
      // eslint-disable-next-line global-require
      const Redis = require("ioredis");
      redisClient = new Redis(redisUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
      // Without an error listener an upstream connection blip throws an
      // unhandled 'error' event and can crash the function.
      redisClient.on("error", (e) => {
        // eslint-disable-next-line no-console
        console.warn("redis client error:", e && e.message);
      });
      backendName = "redis";
    }
  } catch (_) {
    // ioredis not installed / unavailable — fall through to filesystem.
  }
}

const STORE_PATH = process.env.VERCEL
  ? "/tmp/config-store.json"
  : path.join(process.cwd(), ".config-store.json");

function readFsStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function writeFsStore(obj) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2), "utf8");
}

async function get(key) {
  if (kvClient) {
    const v = await kvClient.get(key);
    return v == null ? null : v;
  }
  if (redisClient) {
    const v = await redisClient.get(key);
    if (v == null) return null;
    try { return JSON.parse(v); } catch (_) { return v; }
  }
  const store = readFsStore();
  return store[key] == null ? null : store[key];
}

// opts.ttlSeconds (optional) sets a key expiry on the Redis/KV backends. The
// filesystem fallback ignores it — local dev caches don't expire, which is
// fine; delete .config-store.json to clear them.
async function set(key, value, opts) {
  if (kvClient) {
    if (opts && opts.ttlSeconds) {
      await kvClient.set(key, value, { ex: opts.ttlSeconds });
    } else {
      await kvClient.set(key, value);
    }
    return;
  }
  if (redisClient) {
    const payload = JSON.stringify(value);
    if (opts && opts.ttlSeconds) {
      await redisClient.set(key, payload, "EX", opts.ttlSeconds);
    } else {
      await redisClient.set(key, payload);
    }
    return;
  }
  const store = readFsStore();
  store[key] = value;
  writeFsStore(store);
}

async function list(prefix) {
  if (kvClient) {
    const keys = await kvClient.keys(`${prefix}*`);
    return keys || [];
  }
  if (redisClient) {
    const keys = await redisClient.keys(`${prefix}*`);
    return keys || [];
  }
  const store = readFsStore();
  return Object.keys(store).filter((k) => k.startsWith(prefix));
}

async function del(key) {
  if (kvClient) {
    await kvClient.del(key);
    return;
  }
  if (redisClient) {
    await redisClient.del(key);
    return;
  }
  const store = readFsStore();
  if (key in store) {
    delete store[key];
    writeFsStore(store);
  }
}

// Which backend is active — used by the diagnostic endpoint.
function backend() {
  return backendName;
}

module.exports = { get, set, list, del, backend };
