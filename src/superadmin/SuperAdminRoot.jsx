import React, { useState } from "react";
import SuperAdminDashboard from "./SuperAdminDashboard";
import { adminColors, adminStyles } from "../admin/adminDesign";

const TOKEN_KEY = "super_admin_token";

// Entry point for /super-admin. Password gate + dashboard. Deliberately a
// separate auth path from /admin (different env var, different storage key)
// so a leaked tenant admin password cannot escalate.
export default function SuperAdminRoot() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (_) {
      return "";
    }
  });

  function handleAuthSuccess(authToken) {
    try {
      sessionStorage.setItem(TOKEN_KEY, authToken);
    } catch (_) {}
    setToken(authToken);
  }

  function handleSignOut() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    window.location.reload();
  }

  if (!token) return <PasswordGate onSuccess={handleAuthSuccess} />;
  return <SuperAdminDashboard token={token} onSignOut={handleSignOut} />;
}

function PasswordGate({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/super-admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error || "Incorrect password.");
        setSubmitting(false);
        return;
      }
      const data = await r.json();
      onSuccess(data.token);
    } catch (err) {
      setError("Network error: " + err.message);
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        ...adminStyles.pageWrapper,
        background: "#0F1F3E",
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
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          border: `1px solid ${adminColors.border}`,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 18 }}>
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
              fontSize: 28,
              margin: "0 auto 12px",
            }}
          >
            N
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Nium Platform Administration</h1>
          <p style={{ fontSize: 12, color: adminColors.textMuted, margin: "4px 0 0" }}>
            Super Admin Access
          </p>
        </div>

        <div
          style={{
            marginBottom: 14,
            padding: "8px 12px",
            borderRadius: 8,
            background: adminColors.statusIncompleteBg,
            border: `1px solid ${adminColors.amber}`,
            color: adminColors.statusIncomplete,
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          ⚠ Internal use only — Nium personnel only
        </div>

        <label style={adminStyles.label}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={adminStyles.input}
          placeholder="Enter super admin password"
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
          For client admin access, use your tenant admin URL
        </div>
      </form>
    </div>
  );
}
