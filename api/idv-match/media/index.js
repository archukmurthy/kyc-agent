"use strict";

// Document-image media store (Phase 2.5 sub-step 4).
//
// Stores ONLY identity document images (front / back / portrait page). Selfie,
// liveness, and biometric media are refused - only an external reference records
// that they existed at the provider. Bytes are envelope-encrypted before upload;
// the DB row holds ciphertext pointers only. Retrieval is server-side authorized
// + audited and decrypts on read - never URL-possession (contrast PLAT-1).

const { randomUUID } = require("node:crypto");
const { encryptBytes, decryptBytes } = require("./mediaCrypto");
const { defaultBlobBackend } = require("./blobBackend");
const mediaStore = require("./mediaStore");

const KIND_ALLOWLIST = new Set(["front", "back", "portrait"]);
const KIND_FORBIDDEN = new Set(["selfie", "liveness", "biometric", "face", "video"]);

function normalizeKind(kind) {
  return String(kind || "").trim().toLowerCase();
}

// Enforce the media policy at the boundary: document images only, never
// selfie/liveness/biometric bytes.
function assertStorableKind(kind) {
  const k = normalizeKind(kind);
  if (KIND_FORBIDDEN.has(k)) throw new Error(`refusing to store ${k} media (selfie/liveness/biometrics are not persisted)`);
  if (!KIND_ALLOWLIST.has(k)) throw new Error(`unknown document evidence kind: ${kind}`);
  return k;
}

// Retrieval is not URL-possession: an explicit actor + purpose is required, and
// every access is audited.
function assertAuthorized(authorization) {
  if (!authorization || !authorization.actorId || !authorization.purpose) {
    throw new Error("document media retrieval requires an authorization { actorId, purpose }");
  }
}

function defaultAudit(entry) {
  // Non-PII audit line. Prod would append to an audit table.
  console.log("[idv-media audit]", JSON.stringify(entry));
}

async function storeDocumentImage(input, deps = {}) {
  const { attemptId, bytes, contentType, providerReference, providerCapturedAt, receivedAt } = input;
  if (!attemptId) throw new TypeError("storeDocumentImage requires attemptId");
  const evidenceKind = assertStorableKind(input.evidenceKind);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);

  const backend = deps.blobBackend || defaultBlobBackend();
  const store = deps.mediaStore || mediaStore;

  const enc = await encryptBytes(buffer, { attemptId, evidenceKind }, deps);
  const blobKey = `idv-media/${attemptId}/${randomUUID()}`;
  await backend.put(blobKey, enc.ciphertext, { contentType });

  const id = await store.insertMedia({
    attemptId, evidenceKind, blobKey, contentType,
    byteSize: enc.byteSize, sha256: enc.sha256, nonce: enc.nonce, authTag: enc.authTag,
    wrappedDek: enc.wrappedDek, envelopeVersion: enc.envelopeVersion,
    providerReference, providerCapturedAt,
    receivedAt: receivedAt || new Date().toISOString(),
  });
  return { mediaId: id, blobKey, sha256: enc.sha256 };
}

async function retrieveDocumentImage({ mediaId, authorization }, deps = {}) {
  assertAuthorized(authorization);
  const backend = deps.blobBackend || defaultBlobBackend();
  const store = deps.mediaStore || mediaStore;
  const audit = deps.audit || defaultAudit;

  const row = await store.getMedia(mediaId);
  if (!row) {
    audit({ actorId: authorization.actorId, purpose: authorization.purpose, mediaId, outcome: "not_found" });
    return null;
  }
  const ciphertext = await backend.get(row.blob_key);
  const bytes = await decryptBytes(
    { ciphertext, nonce: row.nonce, authTag: row.auth_tag, wrappedDek: row.wrapped_dek, sha256: row.sha256 },
    { attemptId: row.attempt_id, evidenceKind: row.evidence_kind },
    deps,
  );
  audit({
    actorId: authorization.actorId, purpose: authorization.purpose,
    mediaId, attemptId: row.attempt_id, evidenceKind: row.evidence_kind, outcome: "released",
  });
  return { bytes, contentType: row.content_type, evidenceKind: row.evidence_kind, attemptId: row.attempt_id };
}

// Download a provider presigned media URL and store it. Injectable fetch so the
// webhook path is testable offline; real Didit presigned-media download needs a
// live session (MEDIA-1).
async function ingestFromUrl(input, deps = {}) {
  const { attemptId, evidenceKind, url, providerReference, providerCapturedAt } = input;
  assertStorableKind(evidenceKind);
  if (!url) throw new TypeError("ingestFromUrl requires a url");
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const res = await fetchImpl(url);
  if (!res || !res.ok) throw new Error(`media download failed: ${res && res.status}`);
  const contentType = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") : undefined;
  const bytes = Buffer.from(await res.arrayBuffer());
  return storeDocumentImage(
    { attemptId, evidenceKind, bytes, contentType, providerReference, providerCapturedAt, receivedAt: new Date().toISOString() },
    deps,
  );
}

module.exports = { storeDocumentImage, retrieveDocumentImage, ingestFromUrl, assertStorableKind, KIND_ALLOWLIST, KIND_FORBIDDEN };
