import React, { useEffect, useState, useCallback } from "react";
import AdminDashboard from "./AdminDashboard";
import { adminColors, adminStyles } from "./adminDesign";
import buildDefaultConfig, { buildBlankConfig } from "./defaultConfig";
import { getTenantId } from "../utils/tenant";

const TOKEN_KEY = "admin_token";
const TENANT_KEY = "tenant_id";

// Top-level admin entry point. Responsibilities:
//  - Password gate (POST /api/admin-auth)
//  - Loads tenant config from /api/config on auth
//  - Computes firstLogin flag and hands everything to AdminDashboard
//
// Falls back to a client-side default config if /api/config is unreachable so
// the admin UI still renders something coherent.
export default function AdminRoot() {
  const [tenantId] = useState(() => getTenantId());
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (_) {
      return "";
    }
  });
  const [tenantConfig, setTenantConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const r = await fetch(`/api/config?tenant=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Config fetch failed (${r.status})`);
      const cfg = await r.json();
      setTenantConfig(cfg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Admin config load failed, falling back to client default:", err);
      setConfigError(err.message);
      // Offline fallback: Nium gets the defaults, other tenants get a blank.
      setTenantConfig(tenantId === "nium" ? buildDefaultConfig(tenantId) : buildBlankConfig(tenantId));
    } finally {
      setConfigLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (token) loadConfig();
  }, [token, loadConfig]);

  function handleAuthSuccess(authToken, resolvedTenant) {
    try {
      sessionStorage.setItem(TOKEN_KEY, authToken);
      if (resolvedTenant) sessionStorage.setItem(TENANT_KEY, resolvedTenant);
    } catch (_) {}
    setToken(authToken);
  }

  function handleSignOut() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TENANT_KEY);
    } catch (_) {}
    window.location.reload();
  }

  if (!token) {
    return <PasswordGate tenantId={tenantId} onSuccess={handleAuthSuccess} />;
  }

  if (configLoading || !tenantConfig) {
    return <Loading />;
  }

  const firstLogin =
    !!tenantConfig._isDefault ||
    !tenantConfig.company?.name ||
    (tenantConfig._version || 0) <= 1;

  return (
    <>
      {configError && (
        <div
          style={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 200,
            background: "#fef2f2",
            color: adminColors.danger,
            border: `1px solid ${adminColors.danger}`,
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
          }}
          title={configError}
        >
          API offline — using local defaults
        </div>
      )}
      <AdminDashboard
        tenantConfig={tenantConfig}
        firstLogin={firstLogin}
        token={token}
        tenantId={tenantId}
        onSignOut={handleSignOut}
        onReloadConfig={loadConfig}
      />
    </>
  );
}

function PasswordGate({ tenantId, onSuccess }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin-auth?tenant=${encodeURIComponent(tenantId || "nium")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId || "nium" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        setError("Incorrect password. Please try again.");
        setSubmitting(false);
        return;
      }
      const data = await r.json();
      onSuccess(data.token, data.tenantId);
    } catch (err) {
      setError("Network error: " + err.message);
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        ...adminStyles.pageWrapper,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 32,
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
          border: `1px solid ${adminColors.border}`,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: adminColors.niumBlue,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 26,
              margin: "0 auto 12px",
            }}
          >
            N
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Admin Access</h1>
          <p style={{ fontSize: 12, color: adminColors.textMuted, margin: "4px 0 0" }}>
            Intelligence-Led Onboarding Platform
          </p>
          <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 99, background: "rgba(11,61,145,0.08)", color: adminColors.niumBlue, fontSize: 11, fontWeight: 600 }}>
            Tenant: {tenantId || "nium"}
          </div>
        </div>

        <label style={adminStyles.label}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={adminStyles.input}
          placeholder="Enter admin password"
          autoFocus
        />

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: adminColors.danger,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !password}
          style={{
            ...adminStyles.btnPrimary,
            width: "100%",
            marginTop: 16,
            opacity: submitting || !password ? 0.5 : 1,
            cursor: submitting || !password ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Verifying…" : "Sign In"}
        </button>

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 11, color: adminColors.textMuted }}>
          Authorised personnel only
        </div>
      </form>
    </div>
  );
}

function Loading() {
  return (
    <div
      style={{
        ...adminStyles.pageWrapper,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: adminColors.niumBlue,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 26,
            margin: "0 auto 12px",
            animation: "adminPulse 1.4s ease-in-out infinite",
          }}
        >
          N
        </div>
        <div style={{ fontSize: 13, color: adminColors.textMuted, fontWeight: 600 }}>Loading…</div>
        <style>{`@keyframes adminPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.96); } }`}</style>
      </div>
    </div>
  );
}
