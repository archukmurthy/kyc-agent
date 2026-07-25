/**
 * uploadAmendmentDoc.js — the ONE amendment-document upload call.
 *
 * Posts to the existing /api/upload-document (Vercel Blob, PR-034) and returns
 * the record stored in App's `amendmentUploads` map. Shared by the Confirm row
 * card and the Fill Gaps panel so there is a single upload path, not two.
 *
 * A failed upload NEVER throws to the caller and never blocks the customer: it
 * resolves with uploadFailed:true so the UI can show "not stored, please
 * re-upload". The submit gate treats a failed upload as unsatisfied, so a
 * silent failure cannot let a required document slip through.
 */

export async function uploadAmendmentDoc(file) {
  let blobUrl = null;
  let uploadFailed = false;
  let filename = file && file.name ? file.name : "document";
  try {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await fetch("/api/upload-document", { method: "POST", body: fd });
    if (!resp.ok) throw new Error("Upload failed: " + resp.status);
    const data = await resp.json();
    if (!data.blobUrl) throw new Error(data.error || "No blobUrl returned");
    blobUrl = data.blobUrl;
    filename = data.filename || filename;
  } catch (err) {
    uploadFailed = true;
  }
  return { name: filename, blobUrl, uploadFailed, at: new Date().toISOString() };
}

export default uploadAmendmentDoc;
