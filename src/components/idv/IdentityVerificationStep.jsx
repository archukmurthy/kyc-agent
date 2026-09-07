import React, { useState } from "react";
import QRCode from "qrcode";

const genRef = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? `dev-${crypto.randomUUID()}`
    : `dev-${Date.now()}`;

const FIELD_LABELS = {
  applicantFirstName: "First name",
  applicantLastName: "Last name",
  applicantDateOfBirth: "Date of birth",
  applicantNationality: "Nationality",
  documentType: "Document type",
  documentNumber: "Document number",
  expirationDate: "Expiry date",
  dateOfIssue: "Date of issue",
  issuingState: "Issuing state",
  gender: "Gender",
  placeOfBirth: "Place of birth",
  address: "Address",
};
const STATUS_KEYS = ["livenessStatus", "faceMatchStatus", "diditStatus"];
const MAPPED_KEYS = [
  "applicantFirstName",
  "applicantLastName",
  "applicantDateOfBirth",
  "applicantNationality",
];

const prettify = (k) =>
  FIELD_LABELS[k] ||
  k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 };
const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #ccc",
  borderRadius: 6, fontSize: 14, boxSizing: "border-box",
};
const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12, maxWidth: 640,
};

// Editable model = mapped identity fields + scalar identity extras.
// Statuses and object values (e.g. MRZ) are shown read-only, not as inputs.
function buildEditable(data) {
  const out = {};
  Object.entries(data.mappedFields || {}).forEach(([k, v]) => {
    out[k] = v == null ? "" : String(v);
  });
  Object.entries(data.extras || {}).forEach(([k, v]) => {
    if (STATUS_KEYS.includes(k) || v == null || typeof v === "object") return;
    out[k] = String(v);
  });
  return out;
}

export default function IdentityVerificationStep({ submissionId, onVerified, onContinue, cardStyle, Btn }) {
  const [ref] = useState(submissionId || genRef());
  const [hostedUrl, setHostedUrl] = useState(null);
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [edit, setEdit] = useState({});
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
      setStatus(data.status);
      setResult(data);
      if (data.verified) setEdit(buildEditable(data));
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const updateField = (k, v) => setEdit((p) => ({ ...p, [k]: v }));

  const cont = () => {
    const mapped = {};
    MAPPED_KEYS.forEach((k) => { if (k in edit) mapped[k] = edit[k]; });
    onVerified(mapped);
    onContinue();
  };

  const verified = result && result.verified;
  const mrz = result && result.extras && result.extras.mrz;
  const statuses = result ? STATUS_KEYS.filter((k) => result.extras && result.extras[k]) : [];

  return (
    <div style={cardStyle}>
      <h2>Identity Verification</h2>
      <p style={{ color: "#666" }}>Verify the applicant's identity with Didit (sandbox — synthetic data only).</p>

      {!hostedUrl && <Btn onClick={start} disabled={busy}>{busy ? "Starting…" : "Start verification"}</Btn>}

      {hostedUrl && !verified && (
        <div style={{ marginTop: 16 }}>
          <p>Scan this QR on another device, or open the link:</p>
          {qr && <img src={qr} alt="Didit verification QR" style={{ width: 200, height: 200 }} />}
          <p style={{ wordBreak: "break-all" }}>
            <a href={hostedUrl} target="_blank" rel="noreferrer">{hostedUrl}</a>
          </p>
          <Btn onClick={check} disabled={busy}>{busy ? "Checking…" : "Check status"}</Btn>
          {status && <p>Status: <strong>{status}</strong></p>}
        </div>
      )}

      {verified && (
        <div style={{ marginTop: 16 }}>
          <p>
            Status: <strong style={{ color: "#137333" }}>{status}</strong>
            {" "}— review and correct the details below if needed.
          </p>

          <h3 style={{ marginBottom: 8 }}>Verified details</h3>
          <div style={gridStyle}>
            {Object.keys(edit).map((k) => (
              <div key={k}>
                <label style={labelStyle} htmlFor={`idv-${k}`}>{prettify(k)}</label>
                <input
                  id={`idv-${k}`}
                  style={inputStyle}
                  value={edit[k]}
                  onChange={(e) => updateField(k, e.target.value)}
                />
              </div>
            ))}
          </div>

          {statuses.length > 0 && (
            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {statuses.map((k) => (
                <span key={k} style={{ fontSize: 12, background: "#e6f4ea", color: "#137333", padding: "4px 8px", borderRadius: 12 }}>
                  {prettify(k).replace(" Status", "")}: {result.extras[k]}
                </span>
              ))}
            </div>
          )}

          {mrz && (
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Machine-readable zone (MRZ)</label>
              <textarea
                readOnly
                value={typeof mrz === "object" ? JSON.stringify(mrz, null, 2) : String(mrz)}
                style={{
                  ...inputStyle, maxWidth: 640, minHeight: 96,
                  fontFamily: "monospace", fontSize: 12, whiteSpace: "pre",
                  overflow: "auto", resize: "vertical",
                }}
              />
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <Btn onClick={cont}>Continue</Btn>
          </div>
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </div>
  );
}
