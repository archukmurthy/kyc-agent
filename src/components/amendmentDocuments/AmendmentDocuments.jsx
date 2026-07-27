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
import { AmendmentDocCard } from './AmendmentDocCard';
import { uploadAmendmentDoc } from './uploadAmendmentDoc';
import { canonicalDocs, docKey } from '../companyConfirm/confirmState';

const SECTION = {
  background: '#FEF9EF',
  border: '1px solid #FCD9A8',
  borderRadius: 10,
  padding: '16px 18px',
  marginBottom: 16,
};
const HEADING = { fontSize: 17, fontWeight: 700, margin: '0 0 4px', color: '#7a4f00' };
const SUB = { fontSize: 12, color: '#7a4f0099', margin: '0 0 12px' };
// The row / title / button / upload-state styles moved to AmendmentDocCard,
// which now renders every amendment document — here and on the Confirm row.

// Scope-aware (commit 6a): person documents key by (stakeholderId, docType) so
// one person's upload can never satisfy another person's requirement; company
// documents keep the historic fieldId::docType form. Shared with Confirm so
// both surfaces agree on what is satisfied.
const keyOf = docKey;

export function AmendmentDocuments({ submissionId, initialUploads, onUploadsChange, extraDocuments }) {
  const [documents, setDocuments] = useState([]);
  const [busyKey, setBusyKey] = useState(null);
  // keyOf(doc) -> { name, blobUrl, uploadFailed, at }. Seeded from the parent so
  // amendment uploads survive navigating away from Fill Gaps and back (PR-071).
  // The parent's copy is authoritative — Confirm renders the SAME documents with
  // the same upload store, so a file uploaded there is already satisfied here.
  const [uploads, setUploads] = useState(() => initialUploads || {});
  useEffect(() => { setUploads(initialUploads || {}); }, [initialUploads]);

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
        // Address"). Collapsing is SCOPE-AWARE (commit 6a): company documents
        // dedupe per type as before, but person documents dedupe per
        // (person, type) — "Proof of Identity" is inherently per-person, and
        // collapsing John's and Jane's into one card under-collects identity
        // evidence. Any entry without a docType passes through untouched —
        // never under-collect evidence (safety rule).
        setDocuments(canonicalDocs(arr));
      })
      .catch((err) => console.warn('[AmendmentDocuments] fetch failed:', err));
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  // Union the persisted list with any live-classified documents the parent
  // passes (correct before the read endpoint catches up, and in dev with no
  // DB), collapsed with the same scope-aware key.
  const merged = canonicalDocs(documents, extraDocuments);

  if (!merged.length) return null; // no changes need documents → render nothing

  async function handleUpload(file, doc) {
    // PR-071 — upload to Vercel Blob immediately (PR-034 endpoint) and store the
    // PERMANENT blobUrl rather than an ephemeral browser blob: URL (which is
    // lost on refresh). Shared with the Confirm row card via uploadAmendmentDoc.
    const k = keyOf(doc);
    setBusyKey(k);
    const record = await uploadAmendmentDoc(file);
    setBusyKey(null);
    setUploads((prev) => ({ ...prev, [k]: record }));
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
        {merged.length > 1 ? 's' : ''}.
      </p>

      {merged.map((doc) => {
        const k = keyOf(doc);
        return (
          <AmendmentDocCard
            key={k}
            doc={doc}
            upload={uploads[k]}
            busy={busyKey === k}
            onUpload={handleUpload}
            onRemove={handleRemove}
            variant="panel"
          />
        );
      })}
    </div>
  );
}

export default AmendmentDocuments;
