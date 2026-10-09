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
// Callers use get(key) / set(key, value, opts?) / list(prefix) / del(key),
// and the two atomic operations incr / update described below.
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

// A test process gets its own throwaway file. Test files run in parallel, and
// sharing the developer's store let them wipe it (found 2026-10-01: a full
// test run erased a local trial, its invite and its access list).
const TEST_PROCESS = Boolean(process.env.NODE_TEST_CONTEXT || process.env.JEST_WORKER_ID);
const STORE_PATH = process.env.VERCEL
  ? "/tmp/config-store.json"
  : TEST_PROCESS
    ? path.join(require("os").tmpdir(), `kyc-test-store-${process.pid}.json`)
    : path.join(process.cwd(), ".config-store.json");
if (TEST_PROCESS) {
  const forget = () => { try { fs.unlinkSync(STORE_PATH); } catch (_) { /* never written */ } };
  forget(); // left by an earlier process with this pid that was killed before exit
  process.on("exit", forget);
}

// No file yet is an empty store. A file that cannot be read - caught halfway
// through another process's write - is NOT: treating it as empty made the
// next write save only its one key and erase everything else.
function readFsStore() {
  let raw;
  try {
    raw = fs.readFileSync(STORE_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  return JSON.parse(raw);
}

function writeFsStore(obj) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2), "utf8");
}

// ── Atomic operations ──
// Read-then-write loses updates when two requests interleave: two people
// redeeming one invite both read "3 seats used" and both write 4 (review,
// 2026-10-09). These two do the read and the write in ONE step on the server.
//
//   incr(key, by?, opts?)  adds to a number and answers the new total. With
//                          opts.ttlSeconds the key expires that long after its
//                          last change.
//   update(key, fn)        compare-and-set. fn(current) answers the next value,
//                          null to delete, or undefined to leave it alone; if
//                          somebody else wrote in between, fn runs again on
//                          their value. fn must be synchronous and free of side
//                          effects - it can run more than once. A value written
//                          by update has no TTL. Answers what is now stored.
//
// On Redis both are Lua scripts (EVAL), which run atomically and which Upstash
// REST supports through the same @vercel/kv client.

// The stored string comes back with a marker so the REST client's automatic
// JSON parsing cannot reshape it: "!" is "no value", "~<raw>" is the value.
const READ_RAW = "local v = redis.call('GET', KEYS[1]) if v then return '~' .. v end return '!'";
const SWAP = "local v = redis.call('GET', KEYS[1]) local t = '!' if v then t = '~' .. v end "
  + "if t ~= ARGV[1] then return 0 end "
  + "if ARGV[2] == '' then redis.call('DEL', KEYS[1]) else redis.call('SET', KEYS[1], ARGV[2]) end return 1";
const INCR_EXPIRE = "local n = redis.call('INCRBY', KEYS[1], ARGV[1]) redis.call('EXPIRE', KEYS[1], ARGV[2]) return n";
const UPDATE_ATTEMPTS = 25;

function decodeRaw(raw) {
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

function clone(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function pause(attempt) {
  return new Promise((resolve) => { setTimeout(resolve, Math.floor(Math.random() * 5 * (attempt + 1))); });
}

/** Compare-and-set for both Redis clients: they differ only in how a script is
 *  sent and how a value becomes the stored string. */
function redisUpdate(evalScript, encode) {
  return async function update(key, fn) {
    for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
      const tagged = String(await evalScript(READ_RAW, [key], []));
      const current = tagged === "!" ? null : decodeRaw(tagged.slice(1));
      const next = fn(clone(current));
      if (next === undefined) return current;
      const swapped = Number(await evalScript(SWAP, [key], [tagged, next === null ? "" : encode(next)]));
      if (swapped === 1) return next;
      await pause(attempt);
    }
    throw new Error("storage: a value kept changing and the update was not applied");
  };
}

function kvBackend(client) {
  // @upstash/redis stores a string as-is and anything else as JSON.
  const encode = (value) => (typeof value === "string" ? value : JSON.stringify(value));
  return {
    async get(key) {
      const v = await client.get(key);
      return v == null ? null : v;
    },
    async set(key, value, opts) {
      if (opts && opts.ttlSeconds) await client.set(key, value, { ex: opts.ttlSeconds });
      else await client.set(key, value);
    },
    async list(prefix) {
      return (await client.keys(`${prefix}*`)) || [];
    },
    async del(key) {
      await client.del(key);
    },
    async incr(key, by = 1, opts) {
      if (opts && opts.ttlSeconds) return Number(await client.eval(INCR_EXPIRE, [key], [String(by), String(opts.ttlSeconds)]));
      return Number(await client.incrby(key, by));
    },
    update: redisUpdate((script, keys, args) => client.eval(script, keys, args), encode),
  };
}

function redisBackend(client) {
  return {
    async get(key) {
      const v = await client.get(key);
      return v == null ? null : decodeRaw(v);
    },
    async set(key, value, opts) {
      const payload = JSON.stringify(value);
      if (opts && opts.ttlSeconds) await client.set(key, payload, "EX", opts.ttlSeconds);
      else await client.set(key, payload);
    },
    async list(prefix) {
      return (await client.keys(`${prefix}*`)) || [];
    },
    async del(key) {
      await client.del(key);
    },
    async incr(key, by = 1, opts) {
      if (opts && opts.ttlSeconds) return Number(await client.eval(INCR_EXPIRE, 1, key, String(by), String(opts.ttlSeconds)));
      return Number(await client.incrby(key, by));
    },
    update: redisUpdate((script, keys, args) => client.eval(script, keys.length, ...keys, ...args), JSON.stringify),
  };
}

// One JSON document - the filesystem, or memory for tests. Every operation
// reads, changes and writes with no await in between, so each is atomic within
// the process. TTLs are ignored: local dev caches don't expire, which is fine;
// delete .config-store.json to clear them.
//
// `yieldFirst` makes every call wait a turn before it runs, as a network round
// trip does. A test store needs it: without it, code that reads and then writes
// never interleaves with anything, and a lost update that happens in production
// cannot happen in the test.
function localBackend(load, save, { yieldFirst = false } = {}) {
  const turn = yieldFirst ? () => new Promise((resolve) => { setImmediate(resolve); }) : async () => {};
  return {
    async get(key) {
      await turn();
      const store = load();
      return store[key] == null ? null : clone(store[key]);
    },
    async set(key, value) {
      await turn();
      const store = load();
      store[key] = clone(value);
      save(store);
    },
    async list(prefix) {
      await turn();
      return Object.keys(load()).filter((k) => k.startsWith(prefix));
    },
    async del(key) {
      await turn();
      const store = load();
      if (key in store) {
        delete store[key];
        save(store);
      }
    },
    async incr(key, by = 1) {
      await turn();
      const store = load();
      store[key] = (Number(store[key]) || 0) + by;
      save(store);
      return store[key];
    },
    async update(key, fn) {
      await turn();
      const store = load();
      const current = store[key] == null ? null : store[key];
      const next = fn(clone(current));
      if (next === undefined) return clone(current);
      if (next === null) delete store[key];
      else store[key] = clone(next);
      save(store);
      return clone(next);
    },
  };
}

/** A store in memory with the same atomic guarantees as the real ones, for
 *  tests. `fail(op, key)`, when given, runs before every operation; throwing
 *  from it is a storage outage. */
function createMemoryStore({ fail = null } = {}) {
  let data = {};
  const inner = localBackend(() => data, (next) => { data = next; }, { yieldFirst: true });
  if (!fail) return inner;
  const guarded = {};
  for (const op of Object.keys(inner)) {
    guarded[op] = async (key, ...rest) => { fail(op, key); return inner[op](key, ...rest); };
  }
  return guarded;
}

const active = kvClient ? kvBackend(kvClient)
  : redisClient ? redisBackend(redisClient)
    : localBackend(readFsStore, writeFsStore);

const get = (key) => active.get(key);
// opts.ttlSeconds (optional) sets a key expiry on the Redis/KV backends.
const set = (key, value, opts) => active.set(key, value, opts);
const list = (prefix) => active.list(prefix);
const del = (key) => active.del(key);
const incr = (key, by = 1, opts) => active.incr(key, by, opts);
const update = (key, fn) => active.update(key, fn);

// Which backend is active — used by the diagnostic endpoint.
function backend() {
  return backendName;
}

module.exports = { get, set, list, del, incr, update, backend, createMemoryStore };

// Test seam only: the KV backend around a given client, so a test can check the
// exact commands sent to Upstash with a stubbed fetch.
module.exports.__kvBackend = kvBackend;
