"use strict";

// Byte-level envelope encryption for document-image media.
//
// The module's EnvelopeEncryption is JSON-only (it runs assertNoRawEvidence +
// JSON.stringify), so it cannot take image bytes. We use the same scheme on raw
// Buffers: random per-item DEK, AES-256-GCM over the bytes, DEK wrapped by the
// managed key provider. Dev/test wraps with LocalTestManagedKeyProvider; prod
// uses a real KMS-backed provider (MEDIA-1 / IDV-2).

const { randomBytes, createCipheriv, createDecipheriv, createHash } = require("crypto");
const { LocalTestManagedKeyProvider } = require("../../../idv");

const ENVELOPE_VERSION = 1;

let cachedKeyProvider = null;

// Dev/test key provider. Prefers a stable 32-byte key from IDV_MEDIA_WRAP_KEY
// (base64) so ciphertext stays decryptable across restarts; otherwise an
// ephemeral per-process key (fine within one test/invocation, but media
// encrypted in one process can't be read in another — see MEDIA-1).
function keyProvider(deps = {}) {
  if (deps.keyProvider) return deps.keyProvider;
  if (cachedKeyProvider) return cachedKeyProvider;
  const b64 = process.env.IDV_MEDIA_WRAP_KEY;
  const wrappingKey = b64 ? Buffer.from(b64, "base64") : randomBytes(32);
  if (wrappingKey.length !== 32) throw new Error("IDV_MEDIA_WRAP_KEY must decode to 32 bytes");
  cachedKeyProvider = new LocalTestManagedKeyProvider({ wrappingKey, keyId: "idv-media-local", runtimeMode: "test" });
  return cachedKeyProvider;
}

// AAD binds the ciphertext to its attempt + evidence kind so a wrapped blob
// cannot be silently relabelled or moved to another attempt.
function aad({ attemptId, evidenceKind }) {
  return Buffer.from(JSON.stringify({ attemptId, evidenceKind }), "utf8");
}

async function encryptBytes(bytes, { attemptId, evidenceKind }, deps = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new TypeError("encryptBytes requires non-empty Buffer bytes");
  const keys = keyProvider(deps);
  const dek = randomBytes(32);
  const nonce = randomBytes(12);
  const a = aad({ attemptId, evidenceKind });
  try {
    const cipher = createCipheriv("aes-256-gcm", dek, nonce);
    cipher.setAAD(a);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const wrappedDek = await keys.wrapKey(dek, { aad: a });
    return {
      ciphertext,
      nonce: nonce.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      wrappedDek,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
      envelopeVersion: ENVELOPE_VERSION,
    };
  } finally {
    dek.fill(0);
  }
}

async function decryptBytes({ ciphertext, nonce, authTag, wrappedDek, sha256 }, { attemptId, evidenceKind }, deps = {}) {
  const keys = keyProvider(deps);
  const a = aad({ attemptId, evidenceKind });
  const dek = await keys.unwrapKey(wrappedDek, { aad: a });
  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(nonce, "base64"));
    decipher.setAAD(a);
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
    // Defence in depth: verify our own integrity hash after GCM auth.
    if (sha256 && createHash("sha256").update(plaintext).digest("hex") !== sha256) {
      throw new Error("media integrity check failed (sha256 mismatch)");
    }
    return plaintext;
  } finally {
    dek.fill(0);
  }
}

module.exports = { encryptBytes, decryptBytes, ENVELOPE_VERSION, _resetKeyProviderForTests() { cachedKeyProvider = null; } };
