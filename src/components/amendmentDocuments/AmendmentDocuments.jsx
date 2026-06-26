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
 * button, storing an EPHEMERAL object URL in local component state. That blob
 * lives only in browser memory; durable file storage is a known limitation of
 * the matched pattern and is tracked separately (PR-034), not solved here.
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
const DOC_REASON = { fontSize: 12, color: '#7a4f00' };
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
const REMOVE = { fontSize: 12, color: '#b91c1c', cursor: 'pointer', fontWeight: 600 };

const keyOf = (d) => `${d.fieldId}::${d.docType}`;

export function AmendmentDocuments({ submissionId }) {
  const [documents, setDocuments] = useState([]);
  const [uploads, setUploads] = useState({}); // keyOf(doc) -> { name, url, at }

  useEffect(() => {
    if (!submissionId) return undefined;
    let cancelled = false;
    fetch(`/api/amendment-documents?submissionId=${encodeURIComponent(submissionId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setDocuments(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch((err) => console.warn('[AmendmentDocuments] fetch failed:', err));
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  if (!documents.length) return null; // no changes need documents → render nothing

  function handleUpload(e, doc) {
    const file = e.target.files[0];
    if (!file) return;
    // Ephemeral blob URL — same as App.js#handleManualDocumentUpload. Lives only
    // in browser memory; durable storage tracked in PR-034 (not solved here).
    const url = URL.createObjectURL(file);
    setUploads((prev) => ({
      ...prev,
      [keyOf(doc)]: { name: file.name, url, at: new Date().toISOString() },
    }));
    e.target.value = ''; // allow re-selecting the same file after a Remove
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
              <div style={DOC_TITLE}>{doc.docType}</div>
              {doc.reason && <div style={DOC_REASON}>{doc.reason}</div>}
            </div>

            {up ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={UPLOADED}>✓ {up.name}</span>
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
