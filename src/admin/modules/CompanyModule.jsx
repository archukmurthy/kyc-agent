import React, { useState, useEffect } from "react";
import { card, label, inputBase, btnPrimary, sectionTitle, sectionSub, tokens } from "../styles";

const FIELDS = [
  { key: "name", label: "Company name", type: "text", required: true,
    hint: "Shown in the customer header (\"{name} Compliance\") and on the admin sidebar." },
  { key: "manualFormUrl", label: "Manual application form URL", type: "url",
    hint: "Where customers go when they pick \"I'll complete the form myself\" on the journey screen." },
  { key: "privacyPolicyUrl", label: "Privacy policy URL", type: "url",
    hint: "Linked from the footer on every customer page." },
  { key: "submissionWebhookUrl", label: "Submission webhook URL", type: "url",
    hint: "Admin metadata. Reserved for the future submission backend (not yet called by the app)." },
  { key: "submissionEmail", label: "Submission notification email", type: "email",
    hint: "Admin metadata. Reserved for the future submission backend." },
  { key: "primaryContactName", label: "Primary contact name", type: "text",
    hint: "Admin reference — who owns this tenant. Not shown to customers." },
  { key: "primaryContactEmail", label: "Primary contact email", type: "email",
    hint: "Admin reference. Also surfaced as a \"Contact\" footer link on the customer pages." },
];

export default function CompanyModule({ config, patchConfig, markSaved }) {
  const [local, setLocal] = useState(config.company || {});
  const [saved, setSaved] = useState(false);
  useEffect(() => { setLocal(config.company || {}); }, [config.company]);

  function update(key, value) {
    setLocal((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleLogo(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 500 * 1024) {
      alert("Logo must be 500KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update("logo", String(reader.result));
    reader.readAsDataURL(f);
  }

  function handleSave() {
    patchConfig({ company: local });
    markSaved();
    setSaved(true);
  }

  return (
    <div>
      <h2 style={sectionTitle}>Company Setup</h2>
      <p style={sectionSub}>Branding and contact information. The company name and logo appear in the customer-facing onboarding flow.</p>

      <div style={card}>
        <div style={{ display: "flex", gap: 24, marginBottom: 18, alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 120px" }}>
            <label style={label}>Logo</label>
            <div style={{
              width: 120, height: 120, borderRadius: 12,
              background: "#f4f6f8",
              border: `2px dashed ${tokens.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden", marginBottom: 8,
            }}>
              {local.logo
                ? <img src={local.logo} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : <span style={{ fontSize: 11, color: tokens.textMuted, textAlign: "center", padding: 6 }}>No logo uploaded</span>}
            </div>
            <input type="file" accept="image/*" onChange={handleLogo} style={{ fontSize: 11 }} />
            {local.logo && (
              <button onClick={() => update("logo", null)} style={{ background: "transparent", border: "none", color: tokens.danger, fontSize: 11, marginTop: 4, cursor: "pointer", padding: 0 }}>
                Remove logo
              </button>
            )}
          </div>

          <div style={{ flex: 1 }}>
            {FIELDS.map((f) => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={label}>{f.label} {f.required && <span style={{ color: tokens.danger }}>*</span>}</label>
                <input
                  type={f.type}
                  value={local[f.key] || ""}
                  onChange={(e) => update(f.key, e.target.value)}
                  style={inputBase}
                />
                {f.hint && (
                  <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 4, lineHeight: 1.4 }}>{f.hint}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ color: tokens.teal, fontSize: 12, fontWeight: 600 }}>✓ Saved locally — publish to apply</span>}
          <button style={btnPrimary} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
