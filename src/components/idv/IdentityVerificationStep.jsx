import React, { useState } from "react";
import QRCode from "qrcode";

const genRef = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? `dev-${crypto.randomUUID()}`
    : `dev-${Date.now()}`;

export default function IdentityVerificationStep({ submissionId, onVerified, onContinue, cardStyle, Btn }) {
  const [ref] = useState(submissionId || genRef());
  const [hostedUrl, setHostedUrl] = useState(null);
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/idv-start", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "start failed");
      setHostedUrl(data.hostedUrl);
      setQr(await QRCode.toDataURL(data.hostedUrl));
      setStatus("Not Started");
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const check = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/idv-result", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "result failed");
      setStatus(data.status); setResult(data);
      if (data.verified && data.mappedFields) onVerified(data.mappedFields);
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={cardStyle}>
      <h2>Identity Verification</h2>
      <p style={{ color: "#666" }}>Verify the applicant's identity with Didit (sandbox — synthetic data only).</p>

      {!hostedUrl && <Btn onClick={start} disabled={busy}>{busy ? "Starting…" : "Start verification"}</Btn>}

      {hostedUrl && (
        <div style={{ marginTop: 16 }}>
          <p>Scan this QR on another device, or open the link:</p>
          {qr && <img src={qr} alt="Didit verification QR" style={{ width: 200, height: 200 }} />}
          <p><a href={hostedUrl} target="_blank" rel="noreferrer">{hostedUrl}</a></p>
          <Btn onClick={check} disabled={busy}>{busy ? "Checking…" : "Check status"}</Btn>
          {status && <p>Status: <strong>{status}</strong></p>}
        </div>
      )}

      {result && result.verified && (
        <div style={{ marginTop: 16 }}>
          <h3>Verified — mapped fields</h3>
          <ul>
            {Object.entries(result.mappedFields).map(([k, v]) => (<li key={k}>{k}: {String(v)}</li>))}
          </ul>
          <h3>Extra data (stored)</h3>
          <ul>
            {Object.entries(result.extras).filter(([, v]) => v != null).map(([k, v]) => (
              <li key={k}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</li>
            ))}
          </ul>
          <Btn onClick={onContinue}>Continue</Btn>
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </div>
  );
}
