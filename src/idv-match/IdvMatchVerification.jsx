import React, { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import BandResultView from "./BandResultView";
import { SHOW_TEST_TOOLS } from "../constants/appConstants";

// Inline identity verification for the discrepancy-bands flow (Section B). Starts
// a server-authoritative idv-match attempt bound to the selected officer, shows
// the Didit QR/link, and — once the applicant reports completion — resolves the
// band server-side and renders the outcome via BandResultView. The Band B dialogue
// answers post to /api/idv-match/explain. Only mounted when the flag is on.
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

export default function IdvMatchVerification({ applicationId, officerCandidate, officerCandidates, verifyOnly = false, Btn, cardStyle, onProvideLoa, onReselect, onProceed, onResolved, onConfirmedFields, extraFields, loaUpload, loaUploaded, savedResult, onResultCache }) {
  const [attemptId, setAttemptId] = useState(null);
  const [hostedUrl, setHostedUrl] = useState(null);
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  // Seeded from savedResult (the App-level cache) so navigating back to this
  // step re-shows the already-resolved outcome instead of starting a new
  // Didit session. See the auto-start effect below, which skips start() when
  // a saved result is present.
  const [result, setResult] = useState(savedResult || null);
  const [uploadPrompt, setUploadPrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const Button = Btn || ((props) => <button {...props} />);

  // Auto-start: create the session and show the QR the moment the step opens —
  // no "Start verification" click. Guarded so it fires exactly once. The manual
  // button remains as a fallback if the auto-start errored.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || savedResult) return;
    startedRef.current = true;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-poll: once the session is started, pull the decision from Didit every
  // few seconds so the fetched data appears WITHOUT the applicant clicking. The
  // webhook (the production auto-fetch path) can't reach localhost, so polling
  // gives the same "fetches automatically" behaviour in the demo. The manual
  // "I've completed verification" button stays as a fallback. Stops on any
  // terminal outcome (result set) or on unmount.
  useEffect(() => {
    if (!attemptId || result) return undefined;
    let cancelled = false;
    async function poll() {
      try {
        const res = await postJson("/api/idv-match/resolve", { attemptId });
        if (cancelled) return;
        // Ignore "not complete yet" (needsRetry) and transient errors — keep
        // polling. Any terminal outcome renders immediately.
        if (res && !res.error && !res.needsRetry) applyResult(res);
      } catch (_) { /* keep polling; manual button still available */ }
    }
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
    // applyResult is a stable closure over attemptId/onResolved (both in deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, result]);

  // Record the result, and — for any terminal (non-dialogue) outcome — report a
  // compact summary up so the journey can persist the IDV reference on the
  // submission (attempt id + band + outcome; never PII).
  function applyResult(res) {
    setResult(res);
    if (onResultCache) onResultCache(res);
    if (onResolved && res && res.enabled !== false && !res.dialogue) {
      onResolved({ attemptId, band: res.band || null, outcomeType: res.outcomeType || null });
    }
  }

  async function start() {
    setBusy(true); setError(null);
    try {
      const d = await postJson("/api/idv-match/session", { applicationId, officerCandidate, officerCandidates, verifyOnly });
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
      // Resolve pulls the decision from Didit directly (works locally — no webhook
      // needed). If the check isn't complete yet, it comes back needs-retry.
      const res = await postJson("/api/idv-match/resolve", { attemptId });
      if (res && res.error) { setStatus("waiting for verification…"); return; }
      if (res && res.needsRetry) { setStatus("Not complete yet - finish the Didit check, then click again."); return; }
      applyResult(res);
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
      // Send the document text when it's a text-layer file (deed poll exports,
      // etc.) so the server can check both names. Image OCR is BANDS-1; an image
      // with no text safely routes to review.
      let evidence;
      if (file) {
        evidence = { filename: file.name, contentType: file.type };
        if (file.type && file.type.startsWith("text") && typeof file.text === "function") {
          try { evidence.text = await file.text(); } catch (_) { /* fall back to filename only */ }
        }
      }
      const res = await postJson("/api/idv-match/explain", { attemptId, category, evidence });
      if (res.action === "reselect_officer") { if (onResultCache) onResultCache(null); if (onReselect) onReselect(); return; }
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
        onRetry={() => { setResult(null); setStatus(null); if (onResultCache) onResultCache(null); }}
        extraFields={extraFields}
        loaUpload={loaUpload}
        loaUploaded={loaUploaded}
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
          <Button type="button" disabled={busy} onClick={check}>{busy ? "Checking…" : "I have completed the verification"}</Button>
          <p style={{ fontSize: 12, color: "#1a3a4a80", marginTop: 8 }}>
            This updates on its own once you finish - or click the button to check now.
          </p>
          {status && <p>Status: <strong>{status}</strong></p>}
        </div>
      )}
      {/* DEV ONLY (SHOW_TEST_TOOLS, off in production): skip the Didit session and
          inject a synthetic verified pass so you can click through to later pages
          without scanning the QR / doing the selfie every time. Screening is NOT
          run on this path — use the real flow to test screening/bands. */}
      {SHOW_TEST_TOOLS && !result && (
        <button
          type="button"
          onClick={() => applyResult({
            enabled: true, band: "A", outcomeType: "auto_match",
            applicantView: { title: "Identity verified (test skip)", body: "Didit skipped with test data - dev only." },
            verifiedFields: { firstName: "Test", lastName: "User", dateOfBirth: "1990-01-01", nationality: "GB" },
          })}
          style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: "transparent", color: "#4a9e8e", border: "2px dashed #4a9e8e" }}
        >
          ⏭ Skip verification (test)
        </button>
      )}
    </div>
  );
}
