"use strict";

const MEDIA_LIMITS = Object.freeze({
  maxArtifacts: 20,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 100,
  maxImageBytes: 7_500_000,
  maxImageDimension: 8000,
  maxAggregateBinaryBytes: 20 * 1024 * 1024,
});

const TEXT_MEDIA_TYPES = new Set(["application/json", "text/html"]);
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg"]);
const DOCUMENT_MEDIA_TYPES = new Set(["application/pdf"]);

function canonicalMediaType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function interpretationMediaSupported(value) {
  const mediaType = canonicalMediaType(value);
  return TEXT_MEDIA_TYPES.has(mediaType) || mediaType.endsWith("+json") || IMAGE_MEDIA_TYPES.has(mediaType) || DOCUMENT_MEDIA_TYPES.has(mediaType);
}

function mediaError(code, message, statusCode, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function pngDimensions(bytes) {
  const signature = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (sof.has(marker) && length >= 7) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    offset += length;
  }
  return null;
}

function pdfDetails(bytes) {
  if (bytes.length < 8 || bytes.toString("latin1", 0, 5) !== "%PDF-") return null;
  const text = bytes.toString("latin1");
  if (!/%%EOF\s*$/.test(text)) return { readable: false, encrypted: /\/Encrypt\b/.test(text), pageCount: null };
  const encrypted = /\/Encrypt\b/.test(text);
  const directPages = (text.match(/\/Type\s*\/Page(?!s)\b/g) || []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1])).filter((value) => Number.isInteger(value) && value > 0);
  const pageCount = Math.max(directPages, ...counts, 0) || null;
  return { readable: pageCount !== null, encrypted, pageCount };
}

function providerCapabilities(provider) {
  return typeof provider?.capabilities === "function" ? provider.capabilities() : null;
}

function preflightVerifiedInputs(verifiedInputs, { provider = null, requireProvider = false } = {}) {
  if (!Array.isArray(verifiedInputs) || !verifiedInputs.length) throw mediaError("artifact_id_required", "At least one verified Artifact is required", 400);
  if (verifiedInputs.length > MEDIA_LIMITS.maxArtifacts) throw mediaError("media_limit_exceeded", `At most ${MEDIA_LIMITS.maxArtifacts} Artifacts may be interpreted together`, 413, { limit: MEDIA_LIMITS.maxArtifacts });
  const artifacts = [];
  const contentItems = [];
  let aggregateBinaryBytes = 0;
  let estimatedProviderRequestBytes = 256 * 1024;

  for (const input of verifiedInputs) {
    const artifact = input.artifact;
    const bytes = Buffer.from(input.verifiedContent);
    const mediaType = canonicalMediaType(artifact.mediaType);
    if (!interpretationMediaSupported(mediaType)) throw mediaError("unsupported_media_type", `Targeted interpretation does not support ${mediaType || artifact.representationType}`, 415, { artifactId: artifact.id, mediaType });
    let kind = "text";
    let media = { mediaType, sizeBytes: bytes.length };
    if (DOCUMENT_MEDIA_TYPES.has(mediaType)) {
      kind = "document";
      if (bytes.length > MEDIA_LIMITS.maxPdfBytes) throw mediaError("media_too_large", `PDF Artifact ${artifact.id} exceeds the ${MEDIA_LIMITS.maxPdfBytes}-byte interpretation limit`, 413, { artifactId: artifact.id, limitBytes: MEDIA_LIMITS.maxPdfBytes });
      const details = pdfDetails(bytes);
      if (!details) throw mediaError("invalid_media", `Artifact ${artifact.id} does not contain a valid PDF signature`, 422, { artifactId: artifact.id });
      if (details.encrypted) throw mediaError("encrypted_media", `Encrypted PDF Artifact ${artifact.id} cannot be interpreted`, 422, { artifactId: artifact.id });
      if (!details.readable) throw mediaError("invalid_media", `PDF Artifact ${artifact.id} is not structurally readable`, 422, { artifactId: artifact.id });
      if (details.pageCount > MEDIA_LIMITS.maxPdfPages) throw mediaError("media_too_large", `PDF Artifact ${artifact.id} exceeds the ${MEDIA_LIMITS.maxPdfPages}-page interpretation limit`, 413, { artifactId: artifact.id, pageCount: details.pageCount, limitPages: MEDIA_LIMITS.maxPdfPages });
      media = { ...media, pageCount: details.pageCount, encrypted: false };
    } else if (IMAGE_MEDIA_TYPES.has(mediaType)) {
      kind = "image";
      if (bytes.length > MEDIA_LIMITS.maxImageBytes) throw mediaError("media_too_large", `Image Artifact ${artifact.id} exceeds the ${MEDIA_LIMITS.maxImageBytes}-byte interpretation limit`, 413, { artifactId: artifact.id, limitBytes: MEDIA_LIMITS.maxImageBytes });
      const dimensions = mediaType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
      if (!dimensions) throw mediaError("invalid_media", `Artifact ${artifact.id} does not contain a valid ${mediaType} signature and dimensions`, 422, { artifactId: artifact.id });
      if (dimensions.width > MEDIA_LIMITS.maxImageDimension || dimensions.height > MEDIA_LIMITS.maxImageDimension) throw mediaError("media_too_large", `Image Artifact ${artifact.id} exceeds the ${MEDIA_LIMITS.maxImageDimension} pixel dimension limit`, 413, { artifactId: artifact.id, ...dimensions, limitDimension: MEDIA_LIMITS.maxImageDimension });
      media = { ...media, ...dimensions };
    }
    if (kind !== "text") {
      aggregateBinaryBytes += bytes.length;
      estimatedProviderRequestBytes += 4 * Math.ceil(bytes.length / 3);
    } else {
      estimatedProviderRequestBytes += Buffer.byteLength(input.decodedText || "", "utf8");
    }
    artifacts.push({ artifactId: artifact.id, kind, ...media, order: input.order ?? null, sha256Verified: true });
    contentItems.push({ artifactId: artifact.id, kind, mediaType, bytes: kind === "text" ? null : bytes, text: kind === "text" ? String(input.decodedText || "") : null, order: input.order ?? null, artifact: { id: artifact.id, mediaType, representationType: artifact.representationType, capturedAt: artifact.capturedAt }, sourceMetadata: input.sourceMetadata || {}, media });
  }
  if (aggregateBinaryBytes > MEDIA_LIMITS.maxAggregateBinaryBytes) throw mediaError("media_too_large", `Selected binary Artifacts exceed the ${MEDIA_LIMITS.maxAggregateBinaryBytes}-byte aggregate interpretation limit`, 413, { aggregateBinaryBytes, limitBytes: MEDIA_LIMITS.maxAggregateBinaryBytes });
  const capabilities = providerCapabilities(provider);
  if (requireProvider && !provider) throw mediaError("provider_not_configured", "Live semantic interpretation is not configured", 503);
  if (requireProvider && provider && !capabilities && contentItems.some((item) => item.kind !== "text")) throw mediaError("unsupported_model_media", "The configured provider does not declare multimodal capability", 422);
  if (capabilities) {
    for (const item of contentItems) if (!capabilities.contentKinds?.includes(item.kind)) throw mediaError("unsupported_model_media", `The configured provider/model does not support ${item.kind} inputs`, 422, { artifactId: item.artifactId, kind: item.kind });
    if (capabilities.maxRequestBytes && estimatedProviderRequestBytes > capabilities.maxRequestBytes) throw mediaError("provider_media_rejected", "The selected media exceeds the configured provider/model request limit", 413, { estimatedProviderRequestBytes, providerLimitBytes: capabilities.maxRequestBytes });
  }
  return { artifacts, contentItems, aggregateBinaryBytes, estimatedProviderRequestBytes, providerCapabilities: capabilities, limits: MEDIA_LIMITS };
}

module.exports = { DOCUMENT_MEDIA_TYPES, IMAGE_MEDIA_TYPES, MEDIA_LIMITS, TEXT_MEDIA_TYPES, canonicalMediaType, interpretationMediaSupported, jpegDimensions, mediaError, pdfDetails, pngDimensions, preflightVerifiedInputs, providerCapabilities };
