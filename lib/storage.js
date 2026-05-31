// Config storage layer with two backends.
//
// 1. @vercel/kv — used when the package is installed AND
//    KV_REST_API_URL + KV_REST_API_TOKEN are present. This is the
//    production path; provision a KV database in Vercel to enable.
// 2. Filesystem — fallback for local dev and Vercel deployments
//    without KV provisioned. Writes a single JSON document keyed
//    by the storage key. Repo root in dev, /tmp on Vercel.
//
// The two are interchangeable; callers use get(key) / set(key, value) / list(prefix).

const fs = require("fs");
const path = require("path");

let kvClient = null;
try {
  // Accept either the legacy Vercel KV env names or the Upstash-for-Redis
  // marketplace names. Depending on how the store is provisioned, Vercel
  // injects one pair or the other; resolving both means provisioning "just
  // works" regardless of which integration created the database.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  // Guard against the placeholder values shipped in .env.example so
  // unprovisioned local dev quietly falls back to the filesystem store
  // instead of crashing the request with an Upstash URL parse error.
  if (url && token && /^https:\/\//i.test(url)) {
    // eslint-disable-next-line global-require
    const { createClient } = require("@vercel/kv");
    kvClient = createClient({ url, token });
  }
} catch (_) {
  // @vercel/kv not installed / unavailable — fall through to filesystem.
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
  const store = readFsStore();
  return store[key] == null ? null : store[key];
}

// opts.ttlSeconds (optional) sets a key expiry on the KV backend. The
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
  const store = readFsStore();
  store[key] = value;
  writeFsStore(store);
}

async function list(prefix) {
  if (kvClient) {
    const keys = await kvClient.keys(`${prefix}*`);
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
  const store = readFsStore();
  if (key in store) {
    delete store[key];
    writeFsStore(store);
  }
}

module.exports = { get, set, list, del };
