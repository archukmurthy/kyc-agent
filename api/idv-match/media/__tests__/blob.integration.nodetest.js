const { test } = require("node:test");
const assert = require("node:assert");

// GUARDED: makes REAL private Vercel Blob calls (put/get/del). Off by default.
// Run only with IDV_MEDIA_BLOB_TEST=1 and BLOB_READ_WRITE_TOKEN set. It uses a
// fake in-memory media row store, so it exercises ONLY the real Blob upload ->
// download -> decrypt path and cleans up its object afterwards.
const RUN = process.env.IDV_MEDIA_BLOB_TEST === "1" && !!process.env.BLOB_READ_WRITE_TOKEN;

const media = require("../index");
const { VercelBlobBackend } = require("../blobBackend");
const mediaCrypto = require("../mediaCrypto");

const PLAINTEXT = Buffer.from("guarded-blob-roundtrip-\x00\xff\x10 document bytes");

function fakeMediaStore() {
  const rows = new Map();
  let n = 0;
  return {
    rows,
    insertMedia: async (row) => {
      const id = `m-${++n}`;
      rows.set(id, {
        id, attempt_id: row.attemptId, evidence_kind: row.evidenceKind, blob_key: row.blobKey,
        content_type: row.contentType, sha256: row.sha256, nonce: row.nonce,
        auth_tag: row.authTag, wrapped_dek: row.wrappedDek,
      });
      return id;
    },
    getMedia: async (id) => rows.get(id) || null,
  };
}

test("real private Blob store -> retrieve -> decrypt round-trips", { skip: !RUN }, async () => {
  mediaCrypto._resetKeyProviderForTests();
  const backend = new VercelBlobBackend();
  const store = fakeMediaStore();
  const deps = { blobBackend: backend, mediaStore: store, audit: () => {} };

  let blobKey;
  try {
    const stored = await media.storeDocumentImage(
      { attemptId: "blob-int-att", evidenceKind: "front", bytes: PLAINTEXT, contentType: "image/jpeg" }, deps);
    blobKey = stored.blobKey;

    const out = await media.retrieveDocumentImage(
      { mediaId: stored.mediaId, authorization: { actorId: "int-test", purpose: "INTEGRATION" } }, deps);
    assert.ok(out.bytes.equals(PLAINTEXT), "decrypted bytes must equal the original");
  } finally {
    if (blobKey) await backend.del(blobKey);
  }
});
