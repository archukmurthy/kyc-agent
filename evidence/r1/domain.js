"use strict";

const path = require("node:path");
const { createHash } = require("node:crypto");

const MEDIA = Object.freeze({
  "application/pdf": { extension: "pdf", valid: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
  "image/png": { extension: "png", valid: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  "image/jpeg": { extension: "jpg", valid: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
});

class R1Error extends Error { constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; } }
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function sanitizeFilename(value) { const name = path.basename(String(value || "upload")).replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").trim(); return (name || "upload").slice(0, 255); }
function canonicalMediaType(value) { const v = String(value || "").toLowerCase().split(";")[0].trim(); return v === "image/jpg" ? "image/jpeg" : v; }
function validateInput(input, maxBytes = 10 * 1024 * 1024) {
  if (!input?.idempotencyKey || !input.authorizedTenantId || !input.authorizedContextId || !input.actorType || !input.sourceChannel) throw new R1Error("invalid_request", "Idempotency key, authorized tenant/context, actor type and source channel are required");
  const bytes = Buffer.isBuffer(input.bytes) ? Buffer.from(input.bytes) : Buffer.from(input.bytes || []);
  if (!bytes.length || bytes.length > maxBytes) throw new R1Error("invalid_request", `Artifact must contain 1-${maxBytes} bytes`);
  const mediaType = canonicalMediaType(input.declaredMediaType); const media = MEDIA[mediaType];
  if (!media) throw new R1Error("unsupported_media_type", "Only PDF, PNG and JPEG are supported for R1 ingestion", 415);
  if (!media.valid(bytes)) throw new R1Error("invalid_media", "Artifact bytes do not match the declared media type", 422);
  if (input.sourceEffectiveDate != null && (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(input.sourceEffectiveDate) || Number.isNaN(Date.parse(input.sourceEffectiveDate)))) throw new R1Error("invalid_request", "sourceEffectiveDate must be a valid ISO date or UTC timestamp");
  return { ...input, bytes, mediaType, media, originalFilename: sanitizeFilename(input.originalFilename), contentSha256: sha256(bytes) };
}
function requestFingerprint(input, subjectReferenceId) { return sha256(Buffer.from(JSON.stringify([input.authorizedTenantId,input.authorizedContextId,subjectReferenceId,input.actorType,input.actorId||null,input.sourceChannel,input.sourceLocator||null,input.mediaType,input.originalFilename,input.sourceEffectiveDate||null,input.contentSha256]))); }

module.exports = { MEDIA, R1Error, sha256, sanitizeFilename, canonicalMediaType, validateInput, requestFingerprint };
