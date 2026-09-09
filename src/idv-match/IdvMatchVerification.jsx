import React, { useState } from "react";
import QRCode from "qrcode";
import BandResultView from "./BandResultView";

// Inline identity verification for the discrepancy-bands flow (Section B). Starts
// a server-authoritative idv-match attempt bound to the selected officer, shows
// the Didit QR/link, and — once the applicant reports completion — resolves the
// band server-side and renders the outcome via BandResultView. The Band B dialogue
// answers post to /api/idv-match/explain. Only mounted when the flag is on.
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

export default function IdvMatchVerification({ applicationId, officerCandidate, Btn, cardStyle, onProvideLoa, onReselect, onProceed, onResolved, onConfirmedFields }) {
  const [attemptId, setAttemptId] = useState(null);
  const [hostedUrl, setHostedUrl] = useState(null);
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [uploadPrompt, setUploadPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const Button = Btn || ((props) => <button {...props} />);

  // Record the result, and — for any terminal (non-dialogue) outcome — report a
  // compact summary up so the journey can persist the IDV reference on the
  // submission (attempt id + band + outcome; never PII).
  function applyResult(res) {
    setResult(res);
    if (onResolved && res && res.enabled !== false && !res.dialogue) {
      onResolved({ attemptId, band: res.band || null, outcomeType: res.outcomeType || null });
    }
  }

  async function start() {
    setBusy(true); setError(null);
    try {
      const d = await postJson("/api/idv-match/session", { applicationId, officerCandidate });
      if (d.error) throw new Error(d.error);
      setAttemptId(d.attemptId);
      setHostedUrl(d.hostedVerificationUrl);
      try { setQr(await QRCode.toDataURL(d.hostedVerificationUrl)); } catch (_) { /* link is enough */ }
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
  }

  async function check() {
    if (!attemptId) return;
    setBusy(true); setError(null);
    try {
      const s = await fetch(`/api/idv-match/status?attemptId=${encodeURIComponent(attemptId)}`).then((r) => r.json());
      setStatus(s.status);
      if (s.verified) applyResult(await postJson("/api/idv-match/resolve", { attemptId }));
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
  }

  // On confirm: post the confirmed fields so sensitive extras are stored in the
  // Vault (never on the submission); keep only the declared fields + the opaque
  // reference for the journey to persist.
  async function confirmFields(confirmed) {
    let secureIdentityReference = null;
    try {
      const res = await postJson("/api/idv-match/confirm", { attemptId, confirmedFields: confirmed });
      secureIdentityReference = (res && res.secureIdentityReference) || null;
    } catch (e) { setError(String(e.message || e)); }
    const declared = {
      firstName: confirmed.firstName, lastName: confirmed.lastName,
      dateOfBirth: confirmed.dateOfBirth, nationality: confirmed.nationality,
      secureIdentityReference,
    };
    if (onConfirmedFields) onConfirmedFields(declared);
    if (onProceed) onProceed();
  }

  async function submitExplanation(category, file) {
    setBusy(true); setError(null);
    try {
      // OCR name-extraction from the uploaded document is BANDS-1; until then the
      // filename is sent as context and changed_name safely routes to review.
      const evidence = file ? { filename: file.name } : undefined;
      const res = await postJson("/api/idv-match/explain", { attemptId, category, evidence });
      if (res.action === "reselect_officer") { if (onReselect) onReselect(); return; }
      if (res.needsUpload) { setUploadPrompt(res.uploadPrompt); return; }
      setUploadPrompt(null);
      applyResult(res);
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <BandResultView
        result={result}
        uploadPrompt={uploadPrompt}
        onSubmitExplanation={(c) => submitExplanation(c)}
        onUploadEvidence={(c, f) => submitExplanation(c, f)}
        onProvideLoa={onProvideLoa}
        onProceed={onProceed}
        onConfirm={(confirmed) => confirmFields(confirmed)}
        onRetry={() => { setResult(null); setStatus(null); }}
        Btn={Btn}
      />
    );
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ marginTop: 0 }}>Verify your identity</h3>
      {error && <p role="alert" style={{ color: "#a50e0e" }}>{error}</p>}
      {!attemptId && (
        <Button type="button" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start verification"}</Button>
      )}
      {hostedUrl && (
        <div style={{ marginTop: 12 }}>
          <p>Scan this QR on another device, or open the link:</p>
          {qr && <img src={qr} alt="Didit verification QR" style={{ width: 200, height: 200 }} />}
          <p style={{ wordBreak: "break-all" }}>
            <a href={hostedUrl} target="_blank" rel="noreferrer">{hostedUrl}</a>
          </p>
          <Button type="button" disabled={busy} onClick={check}>{busy ? "Checking…" : "I've completed verification"}</Button>
          {status && <p>Status: <strong>{status}</strong></p>}
        </div>
      )}
    </div>
  );
}
