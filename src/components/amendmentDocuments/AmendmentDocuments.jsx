/**
 * AmendmentDocuments.jsx — the "Amendment Documentation" section at the top of
 * the Fill Gaps page. It lists the documents the customer now owes BECAUSE OF
 * the changes they made on Confirm, each with an upload control.
 *
 * Strict READ-ONLY boundary (the circular-dependency fix, preserved):
 *   dialogue writes events → derivation reads events → THIS renders.
 * This component only FETCHES the derived list from the read route
 * (/api/amendment-documents). It does NOT write change_events, does NOT import
 * the engine, the DAL, or the dialogue, and does NOT reach into Fill Gaps state.
 * Data flows one way; keep it that way.
 *
 * Empty list → renders nothing (no empty section).
 *
 * Upload control: matches the existing manual-upload pattern in App.js
 * (handleManualDocumentUpload) — a hidden <input type="file"> triggered by a
 * button. On selection the file is uploaded to Vercel Blob via
 * /api/upload-document (PR-034) and the PERMANENT blobUrl is stored, then lifted
 * to the parent via onUploadsChange so it lands in the dossier save payload and
 * survives a page refresh (PR-071). A failed upload stores uploadFailed:true and
 * warns, but never blocks the customer.
 */

import React, { useEffect, useState } from 'react';

const SECTION = {
  background: '#FEF9EF',
  border: '1px solid #FCD9A8',
  borderRadius: 10,
  padding: '16px 18px',
  marginBottom: 16,
};
const HEADING = { fontSize: 17, fontWeight: 700, margin: '0 0 4px', color: '#7a4f00' };
const SUB = { fontSize: 12, color: '#7a4f0099', margin: '0 0 12px' };
const ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  padding: '10px 0',
  borderTop: '1px solid #FCD9A8',
};
const DOC_TITLE = { fontSize: 14, fontWeight: 700, color: '#1a3a4a' };
const BTN = {
  fontSize: 12,
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #CBD5E1',
  background: '#fff',
  color: '#1a3a4a',
  cursor: 'pointer',
  fontWeight: 600,
  fontFamily: 'inherit',
};
const UPLOADED = { fontSize: 12, color: '#1a7a4a', fontWeight: 600 };
const WARN = { fontSize: 12, color: '#b45309', fontWeight: 600 };
const REMOVE = { fontSize: 12, color: '#b91c1c', cursor: 'pointer', fontWeight: 600 };

const keyOf = (d) => `${d.fieldId}::${d.docType}`;

export function AmendmentDocuments({ submissionId, initialUploads, onUploadsChange }) {
  const [documents, setDocuments] = useState([]);
  // keyOf(doc) -> { name, blobUrl, uploadFailed, at }. Seeded from the parent so
  // amendment uploads survive navigating away from Fill Gaps and back (PR-071).
  const [uploads, setUploads] = useState(() => initialUploads || {});

  // Lift uploads to the parent so the permanent blobUrls are included in the
  // dossier save payload and persist across a page refresh (PR-071).
  useEffect(() => {
    if (onUploadsChange) onUploadsChange(uploads);
  }, [uploads, onUploadsChange]);

  useEffect(() => {
    if (!submissionId) return undefined;
    let cancelled = false;
    fetch(`/api/amendment-documents?submissionId=${encodeURIComponent(submissionId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data.documents) ? data.documents : [];
        // Deduplicate by docType: several changed fields can map to ONE real
        // document (e.g. three address lines → one "Notice of Change of
        // Address"). Same document → one card; the derived list carries one entry
        // per (fieldId, docType), so same-docType entries are true duplicates.
        // Different docTypes stay separate, and any entry without a docType is
        // passed through untouched — never under-collect evidence (safety rule).
        // Keeps the first occurrence of each docType.
        const seen = new Set();
        const deduped = [];
        for (const d of arr) {
          const t = d && d.docType;
          if (t) { if (seen.has(t)) continue; seen.add(t); }
          deduped.push(d);
        }
        setDocuments(deduped);
      })
      .catch((err) => console.warn('[AmendmentDocuments] fetch failed:', err));
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  if (!documents.length) return null; // no changes need documents → render nothing

  async function handleUpload(e, doc) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset before the await so the same file can be re-selected

    // PR-071 — upload to Vercel Blob immediately (PR-034 endpoint) and store the
    // PERMANENT blobUrl rather than an ephemeral browser blob: URL (which is lost
    // on refresh). Same pattern as App.js#handleManualDocumentUpload.
    let blobUrl = null;
    let uploadFailed = false;
    let filename = file.name;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/upload-document', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error('Upload failed: ' + resp.status);
      const data = await resp.json();
      if (!data.blobUrl) throw new Error(data.error || 'No blobUrl returned');
      blobUrl = data.blobUrl;
      filename = data.filename || file.name;
    } catch (err) {
      // Never block the customer — flag the failure so the UI can warn.
      uploadFailed = true;
    }

    setUploads((prev) => ({
      ...prev,
      [keyOf(doc)]: { name: filename, blobUrl, uploadFailed, at: new Date().toISOString() },
    }));
  }

  function handleRemove(doc) {
    setUploads((prev) => {
      const next = { ...prev };
      delete next[keyOf(doc)];
      return next;
    });
  }

  return (
    <div style={SECTION} data-testid="amendment-documents">
      <h2 style={HEADING}>Amendment Documentation</h2>
      <p style={SUB}>
        Because of the changes you made, please upload the following supporting document
        {documents.length > 1 ? 's' : ''}.
      </p>

      {documents.map((doc, i) => {
        const k = keyOf(doc);
        const up = uploads[k];
        const inputId = `amendment-upload-${i}`;
        return (
          <div style={ROW} key={k}>
            <div style={{ flex: 1, minWidth: 180 }}>
              {/* Document name only — internal rule codes (doc.reason, e.g.
                  "Required by rule ADDR-NOTREFLECTED") are never shown to the
                  customer. */}
              <div style={DOC_TITLE}>{doc.docType}</div>
            </div>

            {up ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {up.uploadFailed ? (
                  <span style={WARN}>⚠ {up.name} — not stored, please re-upload</span>
                ) : (
                  <span style={UPLOADED}>✓ {up.name}</span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  style={REMOVE}
                  onClick={() => handleRemove(doc)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleRemove(doc);
                  }}
                >
                  Remove
                </span>
              </div>
            ) : (
              <>
                <input
                  type="file"
                  id={inputId}
                  accept=".pdf,.png,.jpg,.jpeg"
                  style={{ display: 'none' }}
                  onChange={(e) => handleUpload(e, doc)}
                />
                <button
                  type="button"
                  style={BTN}
                  onClick={() => document.getElementById(inputId).click()}
                >
                  ↑ Upload document
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AmendmentDocuments;
