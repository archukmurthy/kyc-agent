import React, { useEffect, useRef, useState } from "react";
import WizardCard from "../components/WizardCard";
import { adminColors, adminStyles } from "../adminDesign";

const BLANK = {
  name: "",
  logo: null,
  manualFormUrl: "",
  privacyPolicyUrl: "",
  submissionWebhookUrl: "",
  submissionEmail: "",
  primaryContactName: "",
  primaryContactEmail: "",
};

// Step 1 — company setup. Standalone mode shows a save button and a saved
// confirmation; wizard mode pushes every keystroke to the parent so the
// wizard's bottom-nav handles persistence.
export default function StepCompany({ config, onChange, isStandalone = false }) {
  const seed = { ...BLANK, ...(config?.company || {}) };
  const [form, setForm] = useState(seed);
  const [logoPreview, setLogoPreview] = useState(seed.logo);
  const [saved, setSaved] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const savedTimer = useRef(null);

  // Reseed from config when it changes externally (e.g. parent reloads).
  useEffect(() => {
    setForm({ ...BLANK, ...(config?.company || {}) });
    setLogoPreview(config?.company?.logo || null);
  }, [config?._version, config?.company]);

  function update(patch) {
    const next = { ...form, ...patch };
    setForm(next);
    if (!isStandalone) onChange({ company: next });
  }

  function handleLogoFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Logo too large — please upload a file under 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setLogoPreview(dataUrl);
      update({ logo: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogoPreview(null);
    update({ logo: null });
  }

  function handleSave() {
    onChange({ company: form });
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }

  return (
    <WizardCard
      title="Company Setup"
      subtitle="Configure your platform identity. These details appear in the customer-facing onboarding flow."
    >
      <Section title="Branding">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 18 }}>
          <LogoBox preview={logoPreview} onFile={handleLogoFile} onRemove={removeLogo} />
          <div style={{ flex: 1 }}>
            <Field
              label="Company Name"
              helper="Shown in the header of your customer-facing onboarding flow"
              value={form.name}
              placeholder="Your company name"
              onChange={(v) => update({ name: v })}
            />
          </div>
        </div>
      </Section>

      <Section title="Customer Flow">
        <Field
          label="Manual Form URL"
          helper='Where customers are redirected when they choose "Fill it myself"'
          value={form.manualFormUrl}
          placeholder="https://"
          onChange={(v) => update({ manualFormUrl: v })}
        />
        <div style={{ height: 14 }} />
        <Field
          label="Privacy Policy URL"
          helper="Shown on the declaration step"
          value={form.privacyPolicyUrl}
          placeholder="https://"
          onChange={(v) => update({ privacyPolicyUrl: v })}
        />
      </Section>

      <CollapsibleSection
        title="Notifications"
        open={showNotifications}
        onToggle={() => setShowNotifications((v) => !v)}
      >
        <Field
          label="Submission Webhook URL"
          helper="We'll POST completed applications here as JSON"
          value={form.submissionWebhookUrl}
          placeholder="https://"
          onChange={(v) => update({ submissionWebhookUrl: v })}
        />
        <div style={{ height: 14 }} />
        <Field
          label="Submission Email"
          helper="We'll email completed applications to this address"
          value={form.submissionEmail}
          placeholder="compliance@yourcompany.com"
          onChange={(v) => update({ submissionEmail: v })}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Internal Contact"
        open={showContact}
        onToggle={() => setShowContact((v) => !v)}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field
            label="Primary Contact Name"
            value={form.primaryContactName}
            onChange={(v) => update({ primaryContactName: v })}
          />
          <Field
            label="Primary Contact Email"
            value={form.primaryContactEmail}
            placeholder="name@yourcompany.com"
            onChange={(v) => update({ primaryContactEmail: v })}
          />
        </div>
      </CollapsibleSection>

      {isStandalone && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <button type="button" onClick={handleSave} style={adminStyles.btnPrimary}>
            Save Company Setup
          </button>
          {saved && (
            <span style={{ fontSize: 13, color: adminColors.statusComplete, fontWeight: 600 }}>
              ✅ Saved
            </span>
          )}
        </div>
      )}
    </WizardCard>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: adminColors.textMuted, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function CollapsibleSection({ title, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 20, borderTop: `1px solid ${adminColors.border}`, paddingTop: 16 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: adminColors.textMuted,
          marginBottom: open ? 12 : 0,
        }}
      >
        {title}
        <span style={{ fontSize: 14 }}>{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open && children}
    </div>
  );
}

function Field({ label, helper, value, onChange, placeholder }) {
  return (
    <div>
      <label style={adminStyles.label}>{label}</label>
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={adminStyles.input}
      />
      {helper && <div style={adminStyles.helper}>{helper}</div>}
    </div>
  );
}

function LogoBox({ preview, onFile, onRemove }) {
  return (
    <div style={{ flex: "0 0 200px" }}>
      <label style={adminStyles.label}>Logo</label>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 200,
          height: 80,
          border: `1.5px dashed ${adminColors.borderStrong}`,
          borderRadius: 10,
          background: "#fff",
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {preview ? (
          <img src={preview} alt="logo preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ textAlign: "center", color: adminColors.textMuted, fontSize: 12 }}>
            <div style={{ fontSize: 18 }}>⬆</div>
            <div style={{ fontWeight: 600 }}>Upload logo</div>
            <div style={{ fontSize: 10 }}>PNG or SVG, max 2MB</div>
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/svg+xml,image/jpeg"
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {preview && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "none",
            color: adminColors.danger,
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
            fontFamily: "inherit",
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}
