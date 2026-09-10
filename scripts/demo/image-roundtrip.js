"use strict";
/*
 * DEMO: prove a stored (encrypted) document image recovers to a VIEWABLE picture.
 * Authorized + audited retrieve -> decrypt -> write the image file so you can open
 * it. Shows that the image is encrypted at rest (unviewable in Blob) but recovers
 * through the authorized path.
 *
 * Run from E:\kyc-agent-dev:
 *   node -r dotenv/config scripts/demo/image-roundtrip.js <mediaId> dotenv_config_path=.env.local
 */
const fs = require("fs");
const path = require("path");
const media = require("../../api/idv-match/media");

const mediaId = process.argv[2];
if (!mediaId) { console.error("usage: image-roundtrip.js <mediaId>"); process.exit(1); }

(async () => {
  const out = await media.retrieveDocumentImage({ mediaId, authorization: { actorId: "demo-viewer", purpose: "AUDIT_REVIEW" } });
  if (!out) { console.error("media not found:", mediaId); process.exit(1); }
  const ext = (out.contentType || "").includes("png") ? "png" : (out.contentType || "").includes("jpeg") ? "jpg" : "bin";
  const dir = path.join(__dirname, "..", "..", "scratch"); // gitignored — decrypted PII never committed
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `decrypted-${mediaId}.${ext}`);
  fs.writeFileSync(file, out.bytes);
  console.log("Authorized + audited decrypt succeeded (evidence_kind: " + out.evidenceKind + ").");
  console.log("Wrote the VIEWABLE image to:\n  " + file);
  console.log("\nBehind the scenes: ciphertext in Vercel Blob -> authorized retrieve -> decrypt -> viewable " + ext + ".");
  console.log("(Opening the raw Blob object instead would show encrypted bytes, not a picture.)");
})().catch((e) => { console.error("failed:", e.message); process.exit(1); });
