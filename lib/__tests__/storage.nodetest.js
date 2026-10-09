"use strict";

// The local filesystem store (no KV configured). Two ways it lost a
// developer's data on 2026-10-01, each pinned here.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const storage = require("../storage");

const ownFile = path.join(os.tmpdir(), `kyc-test-store-${process.pid}.json`);
// About the file backend only: with KV configured in the shell, writing these
// keys would put them in a real store.
const skip = storage.backend() !== "filesystem" && "KV or Redis is configured";

test("a test process never writes the developer's own store", { skip }, async () => {
  const key = `storage-nodetest:${process.pid}`;
  await storage.set(key, 1);
  assert.equal(await storage.get(key), 1);
  assert.ok(fs.existsSync(ownFile), "a test writes its own throwaway file");
  const developers = path.join(process.cwd(), ".config-store.json");
  if (fs.existsSync(developers)) assert.ok(!(key in JSON.parse(fs.readFileSync(developers, "utf8"))));
});

test("a store caught halfway through a write is refused, never read as empty and saved over", { skip }, async () => {
  await storage.set("kept", "yes");
  fs.writeFileSync(ownFile, '{"kept": "y');
  await assert.rejects(storage.set("other", 1));
  fs.writeFileSync(ownFile, '{"kept": "yes"}');
  assert.equal(await storage.get("kept"), "yes");
});

// Atomic operations (review, 2026-10-09). Read-then-write lost seats, index
// entries and counted spend whenever two requests interleaved; incr and update
// do it in one step on every backend.

test("the memory store loses updates to read-then-write, exactly as production does", async () => {
  const memory = storage.createMemoryStore();
  await Promise.all(Array.from({ length: 20 }, async () => {
    const n = Number(await memory.get("n")) || 0;
    await memory.set("n", n + 1);
  }));
  assert.ok((await memory.get("n")) < 20, "a stand-in that never interleaves hides the bug it should catch");
});

test("incr and update lose nothing under concurrency (memory, and the file when it is the backend)", async () => {
  const stores = [storage.createMemoryStore()];
  if (!skip) stores.push(storage);
  for (const store of stores) {
    const key = `atomic-${process.pid}-${Math.random()}`;
    const totals = await Promise.all(Array.from({ length: 30 }, () => store.incr(`${key}:n`, 1, { ttlSeconds: 60 })));
    assert.equal(await store.get(`${key}:n`), 30);
    assert.deepEqual(totals.sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1), "every caller sees its own total");

    await Promise.all(Array.from({ length: 30 }, (_, i) => store.update(`${key}:list`, (list) => (list || []).concat(i))));
    assert.equal((await store.get(`${key}:list`)).length, 30);
  }
});

test("update: undefined leaves the value alone, null deletes it, and the caller gets a copy", async () => {
  const memory = storage.createMemoryStore();
  await memory.set("k", { a: 1 });
  assert.deepEqual(await memory.update("k", () => undefined), { a: 1 });
  const answered = await memory.update("k", (v) => ({ ...v, b: 2 }));
  answered.b = 99;
  assert.deepEqual(await memory.get("k"), { a: 1, b: 2 });
  assert.equal(await memory.update("k", () => null), null);
  assert.equal(await memory.get("k"), null);
});

test("a failing memory store throws, so callers can be tested against an outage", async () => {
  const memory = storage.createMemoryStore({ fail: (op) => { if (op === "get") throw new Error("kv down"); } });
  await assert.rejects(memory.get("k"), /kv down/);
  await memory.set("k", 1);
});

// The exact commands sent to Upstash REST, through the real @vercel/kv client
// with fetch stubbed. A tiny Redis stand-in answers them.
function fakeUpstash() {
  const data = new Map();
  const ttl = new Map();
  const sent = [];
  const encode = (v) => (typeof v === "string" ? Buffer.from(v).toString("base64") : v);
  function run([name, ...args]) {
    sent.push([name, ...args]);
    const cmd = String(name).toLowerCase();
    if (cmd === "get") return data.has(args[0]) ? data.get(args[0]) : null;
    if (cmd === "set") { data.set(args[0], args[1]); return "OK"; }
    if (cmd === "incrby") { const n = Number(data.get(args[0]) || 0) + Number(args[1]); data.set(args[0], String(n)); return n; }
    if (cmd === "eval") {
      const [script, numKeys, ...rest] = args;
      const keys = rest.slice(0, Number(numKeys));
      const argv = rest.slice(Number(numKeys));
      const current = data.has(keys[0]) ? data.get(keys[0]) : null;
      if (script.includes("INCRBY")) {
        const n = Number(current || 0) + Number(argv[0]);
        data.set(keys[0], String(n));
        ttl.set(keys[0], Number(argv[1]));
        return n;
      }
      if (script.includes("ARGV[2]")) {
        if ((current == null ? "!" : `~${current}`) !== argv[0]) return 0;
        if (argv[1] === "") data.delete(keys[0]); else data.set(keys[0], argv[1]);
        return 1;
      }
      return current == null ? "!" : `~${current}`;
    }
    throw new Error(`unexpected command ${cmd}`);
  }
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const out = String(url).endsWith("/pipeline") ? body.map((c) => ({ result: encode(run(c)) })) : { result: encode(run(body)) };
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { data, ttl, sent, fetch };
}

function upstashStore(t, upstash) {
  t.mock.method(global, "fetch", upstash.fetch);
  const { createClient } = require("@vercel/kv");
  return storage.__kvBackend(createClient({ url: "https://example.upstash.io", token: "test-token" }));
}

test("Upstash: incr is one INCRBY, or one EVAL that also sets the expiry", async (t) => {
  const upstash = fakeUpstash();
  const kv = upstashStore(t, upstash);

  assert.equal(await kv.incr("spend", 1), 1);
  assert.deepEqual(upstash.sent.pop(), ["incrby", "spend", 1]);

  assert.equal(await kv.incr("ratelimit:x", 1, { ttlSeconds: 3600 }), 1);
  const [name, script, numKeys, key, by, seconds] = upstash.sent.pop();
  assert.equal(name, "eval");
  assert.match(script, /INCRBY.*EXPIRE/);
  assert.deepEqual([numKeys, key, by, seconds], [1, "ratelimit:x", "1", "3600"]);
  assert.equal(upstash.ttl.get("ratelimit:x"), 3600);
});

test("Upstash: a failed command's values never reach the error message", async (t) => {
  // @upstash/redis appends the whole command - values included - to its
  // error, and error messages are logged. An invite's value holds emails.
  t.mock.method(global, "fetch", async () => new Response(JSON.stringify({ error: "ERR something broke" }), { status: 400 }));
  const { createClient } = require("@vercel/kv");
  const kv = storage.__kvBackend(createClient({ url: "https://example.upstash.io", token: "test-token" }));
  const failed = await kv.set("ubo-invite:ACME", { redeemedBy: [{ email: "person@example.test" }] }).catch((err) => err);
  assert.match(failed.message, /something broke/);
  assert.doesNotMatch(failed.message, /person@example\.test|command was/);
});

test("Upstash: update reads the raw value and swaps only if nobody wrote in between", async (t) => {
  const upstash = fakeUpstash();
  const kv = upstashStore(t, upstash);

  await kv.set("invite", { seatsUsed: 1, redeemedBy: ["a"] });
  upstash.sent.length = 0;
  let runs = 0;
  const result = await kv.update("invite", (invite) => {
    runs += 1;
    // Somebody else redeems between our read and our write, once.
    if (runs === 1) upstash.data.set("invite", JSON.stringify({ seatsUsed: 2, redeemedBy: ["a", "b"] }));
    return { ...invite, seatsUsed: invite.seatsUsed + 1, redeemedBy: invite.redeemedBy.concat("c") };
  });
  assert.equal(runs, 2, "the first swap is refused and the change is made again on the newer value");
  assert.deepEqual(result, { seatsUsed: 3, redeemedBy: ["a", "b", "c"] });
  assert.deepEqual(await kv.get("invite"), { seatsUsed: 3, redeemedBy: ["a", "b", "c"] });
  const evals = upstash.sent.filter(([name]) => name === "eval");
  assert.equal(evals.length, 4, "read, refused swap, read, swap");
  assert.deepEqual(evals[1].slice(2, 5), [1, "invite", '~{"seatsUsed":1,"redeemedBy":["a"]}']);

  // A value that does not exist yet, then deleting it.
  assert.deepEqual(await kv.update("fresh", (v) => (v ? undefined : ["x"])), ["x"]);
  assert.deepEqual(await kv.get("fresh"), ["x"]);
  await kv.update("fresh", () => null);
  assert.equal(upstash.data.has("fresh"), false);
});
