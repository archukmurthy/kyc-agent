"use strict";

// Name-extraction port for the "I changed my name" evidence check (A2 / BANDS-1).
// Turns an uploaded linking document into a set of normalized name tokens, which
// resolution.handleExplanation checks for BOTH names. This is the seam:
//   - text evidence (text-layer PDF read client-side, or a typed transcription)
//     is tokenized deterministically here;
//   - image-only documents need an OCR provider adapter (tesseract.js is a free
//     local option; a cloud OCR is paid) — that adapter is BANDS-1 and, until it
//     exists, an image with no text yields no tokens -> the case routes to review
//     (never a false pass).
const { normalizeToken } = require("./matching/normalize");

function tokenize(text) {
  const norm = normalizeToken(text);
  return new Set(norm ? norm.split(" ") : []);
}

// evidence: { text?: string, extractedTokens?: string[], ocr?: fn } from the client
// or an injected OCR adapter. Returns a Set of normalized tokens.
async function extractNameTokens(evidence, deps = {}) {
  if (!evidence) return new Set();
  if (typeof evidence.text === "string" && evidence.text.trim()) return tokenize(evidence.text);
  if (Array.isArray(evidence.extractedTokens)) return new Set(evidence.extractedTokens.map(normalizeToken).filter(Boolean));
  // Injected image-OCR adapter (BANDS-1); absent by default.
  const ocr = deps.ocr || evidence.ocr;
  if (typeof ocr === "function" && evidence.bytes) {
    const text = await ocr(evidence.bytes, evidence.contentType);
    return tokenize(text || "");
  }
  return new Set();
}

module.exports = { extractNameTokens, tokenize };
