"use strict";

// Capture Didit DOCUMENT images at result time (A1). Didit's document-image URLs
// are short-lived presigned links, so we download + envelope-encrypt them into
// our media store promptly. ONLY document images (front / back / portrait page) -
// never selfie / liveness / biometrics (those stay external references). Runs
// best-effort: a media failure never blocks verification.
const media = require("./media");

function firstDocument(decision) {
  const d = (decision && (decision.decision || decision)) || {};
  const docs = d.id_verifications || d.id_verification;
  return (Array.isArray(docs) ? docs[0] : docs) || {};
}

// Candidate field names for each document-image kind. Didit's exact keys should
// be confirmed against a real response (BACKLOG BANDS-2); these cover the common
// shapes and simply find nothing (no capture) if absent.
const KIND_FIELDS = [
  { kind: "front", fields: ["front_image", "document_front_image", "document_front", "front"] },
  { kind: "back", fields: ["back_image", "document_back_image", "document_back", "back"] },
  { kind: "portrait", fields: ["portrait_image", "document_portrait", "portrait"] },
];

function isUrl(v) { return typeof v === "string" && /^https?:\/\//i.test(v); }

// Extract { kind, url } for each present document image (deduped by kind).
function extractDocumentImageUrls(decision) {
  const doc = firstDocument(decision);
  const out = [];
  for (const { kind, fields } of KIND_FIELDS) {
    const field = fields.find((f) => isUrl(doc[f]));
    if (field) out.push({ kind, url: doc[field] });
  }
  // Some providers nest images in a documents[] array with {type,url}.
  const arr = Array.isArray(doc.images) ? doc.images : (Array.isArray(decision && decision.documents) ? decision.documents : []);
  for (const item of arr) {
    const kind = String(item && (item.type || item.kind) || "").toLowerCase();
    if (["front", "back", "portrait"].includes(kind) && isUrl(item.url) && !out.some((o) => o.kind === kind)) {
      out.push({ kind, url: item.url });
    }
  }
  return out;
}

async function captureDocumentMedia({ attemptId, decision }, deps = {}) {
  if (!attemptId) return [];
  const store = deps.media || media;
  const doc = firstDocument(decision);
  const providerCapturedAt = doc.created_at || (decision && decision.created_at) || null;
  const captured = [];
  for (const { kind, url } of extractDocumentImageUrls(decision)) {
    try {
      const r = await store.ingestFromUrl({ attemptId, evidenceKind: kind, url, providerReference: `didit:${kind}`, providerCapturedAt }, deps);
      captured.push({ kind, mediaId: r.mediaId });
    } catch (err) {
      console.warn(`[idv-match media] capture ${kind} failed:`, err && err.message);
    }
  }
  return captured;
}

module.exports = { captureDocumentMedia, extractDocumentImageUrls };
