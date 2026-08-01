/**
 * /api/get-document
 *
 * Streaming retrieval for privately-stored Vercel Blob documents.
 *
 * WHY THIS EXISTS: api/upload-document.js now writes with `access: "private"`
 * (the store is private; asking for public 500'd every upload). A private blob
 * is not fetchable by URL, so the one place in the app that links to a stored
 * document — the "View →" anchor on a manually-uploaded registry document,
 * src/App.js — can no longer be a bare <a href={blobUrl}>. It points here
 * instead, and this handler fetches the blob server-side with the store token
 * and pipes the bytes back.
 *
 * ACCESS CONTROL — read this before assuming there is any:
 * There is none beyond possession of the blob URL. The blob URL is an
 * unguessable capability (put() uses addRandomSuffix), and it is handed out by
 * the same unauthenticated dossier context that already exposes it — so this
 * endpoint is exactly as open as the dossier it belongs to, and no more. It is
 * deliberately not made *more* open: the host allowlist below stops it being
 * used as a general-purpose fetch proxy, which is a different problem from
 * authorisation. Real access control for KYC identity documents — session-bound
 * signed URLs (@vercel/blob 2.5.0 supports issueSignedToken + presignUrl) and
 * audited retrieval — arrives with the auth layer, which is tracked as a P1
 * go-live blocker. Do not describe this endpoint as access-controlled.
 *
 * Method: GET
 * Query:  ?url=<encoded blob URL>   (or ?pathname=<store path>)
 * Returns:
 *   - 200 <bytes>    content-type / content-disposition forwarded from the blob
 *   - 400 { error }  missing or non-Blob url
 *   - 404 { error }  no such blob
 *   - 405 { error }  non-GET
 *   - 500 { error }  fetch failure
 *
 * ESM (import / export default) like api/upload-document.js, and like it this
 * route is NOT mounted in src/setupProxy.js (do-not-touch), so it 404s under
 * `npm start`. It works on Vercel by filesystem convention. Same known local-dev
 * gap as the upload route, not a new one.
 */
import { get } from "@vercel/blob";
import { Readable } from "node:stream";

// Only ever fetch from the Blob service. Without this the handler would be a
// generic server-side fetch proxy for any URL a caller supplies.
const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

function isBlobUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch (_) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, pathname } = req.query;
  // A full URL is what the app has stored historically; `pathname` is persisted
  // alongside it for uploads made after the private-write fix. Either resolves.
  const target = typeof url === "string" && url ? url : pathname;

  if (!target || typeof target !== "string") {
    return res.status(400).json({ error: "url or pathname required" });
  }
  // Anything that looks like a URL must be a Blob URL. Bare pathnames are
  // resolved against our own store by the SDK, so they need no host check.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !isBlobUrl(target)) {
    return res.status(400).json({ error: "Not a Vercel Blob URL" });
  }

  try {
    const result = await get(target, { access: "private" });
    if (!result || !result.stream) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Forward what the store recorded at upload time rather than guessing, so a
    // PDF still opens inline and a .docx still downloads as it did when the
    // anchor pointed straight at the blob.
    if (result.blob?.contentType) res.setHeader("Content-Type", result.blob.contentType);
    if (result.blob?.contentDisposition) {
      res.setHeader("Content-Disposition", result.blob.contentDisposition);
    }
    // Deliberately no Content-Length: the platform may re-encode the response,
    // and a stale length truncates the download. Chunked is safe.
    // KYC documents must never be cached by a shared proxy.
    res.setHeader("Cache-Control", "private, no-store");

    // `stream` is a web ReadableStream; the Vercel Node runtime wants a Node one.
    await new Promise((resolve, reject) => {
      const nodeStream = Readable.fromWeb(result.stream);
      nodeStream.on("error", reject);
      res.on("finish", resolve);
      res.on("error", reject);
      nodeStream.pipe(res);
    });
    return undefined;
  } catch (err) {
    // Headers may already be on the wire if the failure happened mid-stream.
    if (res.headersSent) {
      res.end();
      return undefined;
    }
    return res.status(500).json({ error: err?.message || "Could not read document" });
  }
}
