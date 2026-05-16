import React, { useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";
import { buildBlankConfig } from "../defaultConfig";
import { sanitiseTenantId } from "../../utils/tenant";

// Banner above the dashboard status card. Shows the active tenant and the
// buttons that open the Create and Switch modals. Stays cheap-to-render — the
// modals only mount when their state flips.
export default function TenantBanner({ tenantId, companyName, token }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);

  return (
    <>
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          borderLeft: `4px solid ${adminColors.niumBlue}`,
          border: `1px solid ${adminColors.border}`,
          padding: 16,
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: adminColors.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            🏢 Currently configuring
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>
            {companyName || tenantId.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: adminColors.textMuted, fontFamily: "monospace", marginTop: 2 }}>
            tenant id: {tenantId}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setShowCreate(true)} style={adminStyles.btnPrimary}>
            + Create New Tenant
          </button>
          <button type="button" onClick={() => setShowSwitch(true)} style={adminStyles.btnSecondary}>
            Switch Tenant
          </button>
        </div>
      </div>

      {showCreate && (
        <CreateTenantModal
          currentTenantId={tenantId}
          token={token}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showSwitch && <SwitchTenantModal onClose={() => setShowSwitch(false)} />}
    </>
  );
}

function CreateTenantModal({ currentTenantId, token, onClose }) {
  const [tenantId, setTenantId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [startFrom, setStartFrom] = useState("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const sanitised = sanitiseTenantId(tenantId);
  const isValid =
    !!tenantId.trim() &&
    sanitised === tenantId.toLowerCase() &&
    sanitised.length >= 2 &&
    sanitised !== "nium"; // can't recreate the default tenant

  async function checkExists(tid) {
    try {
      const r = await fetch(`/api/config?tenant=${encodeURIComponent(tid)}`, { cache: "no-store" });
      if (!r.ok) return false;
      const data = await r.json();
      return !data._isBlank;
    } catch (_) {
      return false;
    }
  }

  async function fetchNiumSeed() {
    const r = await fetch(`/api/config?tenant=nium`, { cache: "no-store" });
    if (!r.ok) throw new Error("Could not fetch Nium defaults to copy");
    const cfg = await r.json();
    delete cfg._version;
    delete cfg._publishedAt;
    delete cfg._tenantId;
    delete cfg._isDefault;
    delete cfg._isBlank;
    return cfg;
  }

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const exists = await checkExists(sanitised);
      if (exists) throw new Error(`Tenant "${sanitised}" already exists.`);

      let body;
      if (startFrom === "blank") {
        body = buildBlankConfig(sanitised);
      } else {
        body = await fetchNiumSeed();
      }
      if (companyName.trim()) {
        body.company = { ...(body.company || {}), name: companyName.trim() };
      }

      const r = await fetch(`/api/config?tenant=${encodeURIComponent(sanitised)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Tenant-Id": sanitised,
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSuccess({ tenantId: sanitised, version: data.version });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <Modal onClose={onClose}>
        <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>✅ Tenant created</h3>
        <p style={{ fontSize: 13, color: adminColors.text, marginTop: 8 }}>
          Tenant <strong>{success.tenantId}</strong> is ready (v{success.version}).
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          <a
            href={`/admin?tenant=${success.tenantId}`}
            target="_blank"
            rel="noreferrer"
            style={{ ...adminStyles.btnPrimary, textAlign: "center", textDecoration: "none" }}
          >
            Open admin for this tenant →
          </a>
          <a
            href={`/?tenant=${success.tenantId}`}
            target="_blank"
            rel="noreferrer"
            style={{ ...adminStyles.btnSecondary, textAlign: "center", textDecoration: "none" }}
          >
            Open customer flow →
          </a>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onClose} style={adminStyles.btnGhost}>Close</button>
        </div>
      </Modal>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "yourdomain.com";

  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Create New Tenant</h3>
      <p style={{ fontSize: 13, color: adminColors.textMuted, marginTop: 6 }}>
        Each tenant has completely isolated configuration and onboarding flows.
      </p>

      <Field label="Tenant ID *" helper="Unique identifier — lowercase letters, numbers and hyphens only. Cannot be changed later.">
        <input
          type="text"
          value={tenantId}
          placeholder="e.g. acme-payments"
          onChange={(e) => setTenantId(e.target.value)}
          style={adminStyles.input}
          autoFocus
        />
        {tenantId && (
          <div style={{ marginTop: 6, fontSize: 11, color: adminColors.textMuted, fontFamily: "monospace" }}>
            Will be saved as: <strong>{sanitised}</strong>
            <div style={{ marginTop: 4 }}>Customer URL: {origin}/?tenant={sanitised}</div>
            <div>Admin URL: {origin}/admin?tenant={sanitised}</div>
          </div>
        )}
      </Field>

      <Field label="Company Name" helper="You can set this later in Company Setup">
        <input
          type="text"
          value={companyName}
          placeholder="e.g. Acme Payments Ltd"
          onChange={(e) => setCompanyName(e.target.value)}
          style={adminStyles.input}
        />
      </Field>

      <Field label="Start from">
        <label style={radioRow}>
          <input type="radio" checked={startFrom === "blank"} onChange={() => setStartFrom("blank")} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Blank configuration</div>
            <div style={{ fontSize: 12, color: adminColors.textMuted }}>
              Start with empty schemas. Best for a completely new setup.
            </div>
          </div>
        </label>
        {currentTenantId === "nium" && (
          <label style={radioRow}>
            <input type="radio" checked={startFrom === "nium"} onChange={() => setStartFrom("nium")} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Copy from Nium defaults</div>
              <div style={{ fontSize: 12, color: adminColors.textMuted }}>
                Start with Nium&apos;s current field schemas as a template. Best for similar compliance requirements.
              </div>
            </div>
          </label>
        )}
      </Field>

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: adminColors.danger, fontSize: 12, fontWeight: 600 }}>
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
          disabled={!isValid || busy}
          style={{ ...adminStyles.btnPrimary, opacity: !isValid || busy ? 0.5 : 1, cursor: !isValid || busy ? "not-allowed" : "pointer" }}
        >
          {busy ? "Creating…" : "Create Tenant →"}
        </button>
      </div>
    </Modal>
  );
}

function SwitchTenantModal({ onClose }) {
  const [target, setTarget] = useState("");
  const sanitised = sanitiseTenantId(target);
  const isValid = !!target.trim() && sanitised.length >= 1;

  function handleSwitch() {
    if (!isValid) return;
    window.location.href =
      sanitised === "nium" ? "/admin" : `/admin?tenant=${encodeURIComponent(sanitised)}`;
  }

  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Switch Tenant</h3>
      <Field label="Tenant ID" helper="Enter the tenant ID to switch to">
        <input
          type="text"
          value={target}
          placeholder="e.g. acme-payments"
          onChange={(e) => setTarget(e.target.value)}
          style={adminStyles.input}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSwitch()}
        />
        {target && (
          <div style={{ marginTop: 6, fontSize: 11, color: adminColors.textMuted, fontFamily: "monospace" }}>
            Will load: /admin{sanitised === "nium" ? "" : `?tenant=${sanitised}`}
          </div>
        )}
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <button type="button" onClick={onClose} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSwitch}
          disabled={!isValid}
          style={{ ...adminStyles.btnPrimary, opacity: isValid ? 1 : 0.5, cursor: isValid ? "pointer" : "not-allowed" }}
        >
          Switch →
        </button>
      </div>
    </Modal>
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
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 24,
          width: "100%",
          maxWidth: 460,
          boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
        }}
      >
        {children}
      </div>
    </div>
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

const radioRow = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: 10,
  border: `1px solid ${adminColors.border}`,
  borderRadius: 8,
  marginBottom: 8,
  cursor: "pointer",
};
