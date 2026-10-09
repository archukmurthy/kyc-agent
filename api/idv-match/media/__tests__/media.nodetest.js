const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const media = require("../index");
const { InMemoryBlobBackend } = require("../blobBackend");
const mediaCrypto = require("../mediaCrypto");

beforeEach(() => mediaCrypto._resetKeyProviderForTests());

const PLAINTEXT = Buffer.from("fake-passport-front-image-bytes-\x00\x01\x02");

function fakeMediaStore() {
  const rows = new Map();
  let n = 0;
  return {
    rows,
    insertMedia: async (row) => {
      const id = row.id || `m-${++n}`;
      rows.set(id, {
        id, attempt_id: row.attemptId, evidence_kind: row.evidenceKind, blob_key: row.blobKey,
        content_type: row.contentType, byte_size: row.byteSize, sha256: row.sha256,
        nonce: row.nonce, auth_tag: row.authTag, wrapped_dek: row.wrappedDek,
        provider_reference: row.providerReference,
      });
      return id;
    },
    getMedia: async (id) => rows.get(id) || null,
  };
}

function makeDeps(over = {}) {
  const audits = [];
  return {
    audits,
    deps: {
      blobBackend: over.blobBackend || new InMemoryBlobBackend(),
      mediaStore: over.mediaStore || fakeMediaStore(),
      audit: (e) => audits.push(e),
    },
  };
}

const AUTH = { actorId: "reviewer-1", purpose: "AUDIT_REVIEW" };

test("store then authorized retrieve round-trips the exact bytes", async () => {
  const { deps } = makeDeps();
  const { mediaId } = await media.storeDocumentImage(
    { attemptId: "att-1", evidenceKind: "front", bytes: PLAINTEXT, contentType: "image/jpeg" }, deps);
  const out = await media.retrieveDocumentImage({ mediaId, authorization: AUTH }, deps);
  assert.ok(out.bytes.equals(PLAINTEXT));
  assert.strictEqual(out.evidenceKind, "front");
  assert.strictEqual(out.attemptId, "att-1");
});

test("the DB row holds ciphertext pointers only - no plaintext bytes", async () => {
  const { deps } = makeDeps();
  const { mediaId } = await media.storeDocumentImage(
    { attemptId: "att-1", evidenceKind: "back", bytes: PLAINTEXT }, deps);
  const row = deps.mediaStore.rows.get(mediaId);
  assert.ok(row.blob_key && row.sha256 && row.nonce && row.auth_tag && row.wrapped_dek);
  assert.ok(!JSON.stringify(row).includes("fake-passport"), "row must not contain plaintext");
});

test("stored blob is ciphertext, not the plaintext bytes", async () => {
  const backend = new InMemoryBlobBackend();
  const { deps } = makeDeps({ blobBackend: backend });
  const { blobKey } = await media.storeDocumentImage(
    { attemptId: "att-1", evidenceKind: "front", bytes: PLAINTEXT }, deps);
  const stored = await backend.get(blobKey);
  assert.ok(!stored.equals(PLAINTEXT), "blob must be encrypted");
  assert.ok(!stored.toString("latin1").includes("fake-passport"));
});

test("refuses selfie / liveness / biometric media", async () => {
  const { deps } = makeDeps();
  for (const kind of ["selfie", "liveness", "biometric", "face"]) {
    await assert.rejects(
      () => media.storeDocumentImage({ attemptId: "att-1", evidenceKind: kind, bytes: PLAINTEXT }, deps),
      /not persisted|refusing/i, `expected ${kind} rejected`);
  }
});

test("rejects an unknown evidence kind", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    () => media.storeDocumentImage({ attemptId: "att-1", evidenceKind: "hologram", bytes: PLAINTEXT }, deps),
    /unknown document evidence kind/);
});

test("retrieval requires an authorization (not URL-possession)", async () => {
  const { deps } = makeDeps();
  const { mediaId } = await media.storeDocumentImage(
    { attemptId: "att-1", evidenceKind: "front", bytes: PLAINTEXT }, deps);
  await assert.rejects(() => media.retrieveDocumentImage({ mediaId, authorization: null }, deps), /requires an authorization/);
  await assert.rejects(() => media.retrieveDocumentImage({ mediaId, authorization: { actorId: "x" } }, deps), /requires an authorization/);
});

test("every retrieval is audited", async () => {
  const { deps, audits } = makeDeps();
  const { mediaId } = await media.storeDocumentImage(
    { attemptId: "att-1", evidenceKind: "front", bytes: PLAINTEXT }, deps);
  await media.retrieveDocumentImage({ mediaId, authorization: AUTH }, deps);
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].outcome, "released");
  assert.strictEqual(audits[0].actorId, "reviewer-1");
});

test("tampered ciphertext fails authenticated decryption", async () => {
  const backend = new InMemoryBlobBackend();
  const { deps } = makeDeps({ blobBackend: backend });
  const { mediaId, blobKey } = await media.storeDocumentImage(
    { attemptId: "att-1", evidenceKind: "front", bytes: PLAINTEXT }, deps);
  const corrupt = await backend.get(blobKey);
  corrupt[0] ^= 0xff;
  await backend.put(blobKey, corrupt);
  await assert.rejects(() => media.retrieveDocumentImage({ mediaId, authorization: AUTH }, deps));
});

test("ingestFromUrl downloads via injected fetch and stores decryptably", async () => {
  const { deps } = makeDeps();
  const fetchImpl = async (url) => ({
    ok: true,
    headers: { get: (h) => (h === "content-type" ? "image/png" : null) },
    arrayBuffer: async () => PLAINTEXT.buffer.slice(PLAINTEXT.byteOffset, PLAINTEXT.byteOffset + PLAINTEXT.byteLength),
  });
  const { mediaId } = await media.ingestFromUrl(
    { attemptId: "att-1", evidenceKind: "portrait", url: "https://provider.example/presigned" },
    { ...deps, fetchImpl });
  const out = await media.retrieveDocumentImage({ mediaId, authorization: AUTH }, deps);
  assert.ok(out.bytes.equals(PLAINTEXT));
  assert.strictEqual(out.evidenceKind, "portrait");
});

test("ingestFromUrl refuses a forbidden kind before downloading", async () => {
  const { deps } = makeDeps();
  let fetched = false;
  const fetchImpl = async () => { fetched = true; return { ok: true }; };
  await assert.rejects(
    () => media.ingestFromUrl({ attemptId: "att-1", evidenceKind: "selfie", url: "https://x" }, { ...deps, fetchImpl }),
    /not persisted|refusing/i);
  assert.strictEqual(fetched, false, "must not download forbidden media");
});
