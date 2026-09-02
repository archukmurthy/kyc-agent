import React, { useEffect, useState } from "react";
import { adminColors, adminStyles } from "../../admin/adminDesign";
import { generatePassword } from "../../utils/auth";
import { sanitiseTenantId } from "../../utils/tenant";

// Create-tenant flow: tenant ID + company name + (auto-)generated password +
// start-from radio. POSTs to /api/tenants and hands the freshly minted
// credentials to the parent so they can be shown in CredentialsModal.
export default function CreateTenantModal({ token, onClose, onCreated }) {
  const [tenantId, setTenantId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [startFrom, setStartFrom] = useState("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const sanitised = sanitiseTenantId(tenantId);
  const isReserved = ["super-admin", "admin", "api", "demo"].includes(sanitised);
  const idValid =
    !!tenantId.trim() &&
    sanitised === tenantId.toLowerCase() &&
    sanitised.length >= 2 &&
    !isReserved;
  const valid = idValid && !!companyName.trim() && !!password.trim();

  useEffect(() => {
    // Trap Escape from accidentally closing without saving
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCreate() {
    if (!valid) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenantId: sanitised, companyName: companyName.trim(), password, startFrom }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onCreated({
        tenantId: data.tenantId,
        companyName: data.companyName,
        password,
        adminUrl: data.adminUrl,
        customerUrl: data.customerUrl,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "yourdomain.com";

  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Create New Tenant</h3>
      <p style={{ fontSize: 13, color: adminColors.textMuted, marginTop: 6 }}>
        Set up a new client onboarding environment.
      </p>

      <Field label="Tenant ID *" helper="Lowercase letters, numbers and hyphens only. Cannot be changed later.">
        <input
          type="text"
          value={tenantId}
          placeholder="e.g. acme-payments"
          onChange={(e) => setTenantId(e.target.value)}
          style={adminStyles.input}
          autoFocus
        />
        {tenantId && (
          <div style={{ marginTop: 8, fontSize: 11, color: adminColors.textMuted, fontFamily: "monospace", lineHeight: 1.6 }}>
            Saved as: <strong>{sanitised}</strong>{" "}
            {isReserved && <span style={{ color: adminColors.danger }}>(reserved — pick another)</span>}
            <div>Admin: {origin}/admin?tenant={sanitised}</div>
            <div>Customer: {origin}/?tenant={sanitised}</div>
          </div>
        )}
      </Field>

      <Field label="Company Name *">
        <input
          type="text"
          value={companyName}
          placeholder="e.g. Acme Payments Ltd"
          onChange={(e) => setCompanyName(e.target.value)}
          style={adminStyles.input}
        />
      </Field>

      <Field label="Admin Password *" helper="You will share this with the client. Store it securely — it is shown once after creation.">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ ...adminStyles.input, fontFamily: "monospace" }}
          />
          <button type="button" onClick={() => setPassword(generatePassword())} style={adminStyles.btnSecondary} title="Generate a new random password">
            Generate ↻
          </button>
        </div>
      </Field>

      <Field label="Start from">
        <RadioCard
          checked={startFrom === "blank"}
          onChange={() => setStartFrom("blank")}
          title="Blank configuration (recommended)"
          body="Client starts with empty schemas. Best for custom requirements."
        />
        <RadioCard
          checked={startFrom === "demo-defaults"}
          onChange={() => setStartFrom("demo-defaults")}
          title="Copy Demo defaults as template"
          body="Starts with Demo's UK/SG schemas as a template. Client can modify."
        />
      </Field>

      {error && (
        <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: adminColors.danger, fontSize: 12, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button type="button" onClick={onClose} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!valid || busy}
          style={{ ...adminStyles.btnPrimary, opacity: !valid || busy ? 0.5 : 1, cursor: !valid || busy ? "not-allowed" : "pointer" }}
        >
          {busy ? "Creating…" : "Create Tenant →"}
        </button>
      </div>
    </Modal>
  );
}

function RadioCard({ checked, onChange, title, body }) {
  return (
    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: 12,
        border: `1.5px solid ${checked ? adminColors.brandBlue : adminColors.border}`,
        background: checked ? "rgba(11,61,145,0.04)" : "#fff",
        borderRadius: 10,
        cursor: "pointer",
        marginBottom: 8,
      }}
    >
      <input type="radio" checked={checked} onChange={onChange} style={{ marginTop: 3 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 3 }}>{body}</div>
      </div>
    </label>
  );
}

function Field({ label, helper, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      {label && <label style={adminStyles.label}>{label}</label>}
      {children}
      {helper && <div style={adminStyles.helper}>{helper}</div>}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 26,
          width: "100%",
          maxWidth: 520,
          boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}
