/**
 * /api/upload-document
 *
 * PR-034 — Vercel Blob permanent document storage.
 *
 * Receives a single file as multipart/form-data (field name: "file"), uploads
 * it to Vercel Blob, and returns the permanent URL. This replaces the previous
 * pattern of storing uploads as ephemeral browser blob: URLs (blob:http://...)
 * that do not survive a page reload. Unblocks PR-040 / PR-043.
 *
 * ACCESS: private. The linked Blob store is configured private, and this handler
 * previously asked for `access: "public"` — a combination the Blob API rejects
 * outright, so every upload 500'd and no upload has ever succeeded. Writing
 * private makes the code and the store agree.
 *
 * What "private" does and does NOT buy us: blobs are no longer world-readable by
 * URL (a real improvement for KYC identity documents), but retrieval via
 * /api/get-document is still gated only by possession of the dossier context —
 * the same capability that already opens the dossier itself. Real access control
 * (session-bound signed URLs, audited retrieval) belongs to the auth layer,
 * tracked as a P1 go-live blocker. Do not read this as "documents are now
 * access-controlled".
 *
 * Method: POST
 * Body:    multipart/form-data with a "file" part
 * Returns:
 *   - 200 { blobUrl: <permanent URL>, pathname: <store path>, filename }
 *   - 405 { error }   non-POST
 *   - 400 { error }   no file in the request
 *   - 500 { error }   parse / upload failure
 *
 * Auth: put() reads the BLOB_READ_WRITE_TOKEN environment variable
 * automatically. Set it in the Vercel dashboard (Settings → Environment
 * Variables) from the Blob store linked to this project. No token in the repo.
 */
import { put } from "@vercel/blob";
import formidable from "formidable";
import { readFile, open } from "fs/promises";
import routeAuth from "../lib/routeAuth.js";
import rateLimit from "../lib/rateLimit.js";
import uploadValidation from "../lib/uploadValidation.js";

const { applyCors } = routeAuth;
const { enforceRateLimit } = rateLimit;
const { validateUpload, MAX_UPLOAD_BYTES } = uploadValidation;

// Vercel's default body parser would consume the multipart stream before we can
// read it — disable it so formidable can parse the raw request.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (applyCors(req, res)) return undefined;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  // Batch 0: no credential to check until Batch 1, so the limiter is the only
  // brake on someone filling our store with junk.
  if (!(await enforceRateLimit(req, res, "upload-document"))) return undefined;

  try {
    // The size cap is enforced by the parser as well as checked afterwards:
    // without it formidable would write the whole file to disk first (its
    // default allows 200MB), so a large upload costs us before we refuse it.
    const form = formidable({ multiples: false, maxFiles: 1, maxFileSize: MAX_UPLOAD_BYTES });
    // formidable v3 promise API returns [fields, files]; each field is an array.
    const [, files] = await form.parse(req);

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded) {
      return res.status(400).json({ error: 'No file provided under form field "file"' });
    }

    const filename = uploaded.originalFilename || "";

    // The browser checks type and size too, but this is where the file actually
    // arrives - anyone can POST straight here. The declared type, the extension
    // and the first bytes all have to agree.
    let head = Buffer.alloc(0);
    const handle = await open(uploaded.filepath, "r");
    try {
      const buf = Buffer.alloc(8);
      const { bytesRead } = await handle.read(buf, 0, 8, 0);
      head = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    const check = validateUpload({ filename, mimetype: uploaded.mimetype, size: uploaded.size, head });
    if (!check.ok) return res.status(check.status).json({ error: check.error });

    const fileBuffer = await readFile(uploaded.filepath);

    const blob = await put(filename, fileBuffer, {
      access: "private",
      addRandomSuffix: true,
      contentType: check.mimetype,
    });

    // Return `pathname` as well as `url`. addRandomSuffix means the pathname is
    // NOT reconstructable from `filename`, so dropping it here (as this handler
    // used to) is what would later force a list()/head() backfill to adopt
    // signed URLs — the cleaner long-term read path, which is keyed by pathname.
    // Streaming retrieval works from the full URL and does not need it; persist
    // it anyway as cheap insurance that keeps that door open.
    return res.status(200).json({ blobUrl: blob.url, pathname: blob.pathname, filename });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Upload failed" });
  }
}
