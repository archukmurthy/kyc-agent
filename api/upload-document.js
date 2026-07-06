/**
 * /api/upload-document
 *
 * PR-034 — Vercel Blob permanent document storage.
 *
 * Receives a single file as multipart/form-data (field name: "file"), uploads
 * it to Vercel Blob, and returns the permanent public URL. This replaces the
 * previous pattern of storing uploads as ephemeral browser blob: URLs
 * (blob:http://...) that do not survive a page reload. Unblocks PR-040 / PR-043.
 *
 * Method: POST
 * Body:    multipart/form-data with a "file" part
 * Returns:
 *   - 200 { blobUrl: <permanent URL>, filename: <original name> }
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
import { readFile } from "fs/promises";

// Vercel's default body parser would consume the multipart stream before we can
// read it — disable it so formidable can parse the raw request.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({ multiples: false });
    // formidable v3 promise API returns [fields, files]; each field is an array.
    const [, files] = await form.parse(req);

    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!uploaded) {
      return res.status(400).json({ error: 'No file provided under form field "file"' });
    }

    const filename = uploaded.originalFilename || "document";
    const fileBuffer = await readFile(uploaded.filepath);

    const blob = await put(filename, fileBuffer, {
      access: "public",
      addRandomSuffix: true,
    });

    return res.status(200).json({ blobUrl: blob.url, filename });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Upload failed" });
  }
}
