import React, { useState, useEffect } from "react";
import AdminSetup from "./AdminSetup";
import { tokens, inputBase, label, btnPrimary, card } from "./styles";

const TOKEN_KEY = "admin_token";

export default function AdminApp() {
  const [token, setToken] = useState(() => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; }
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tenantConfig, setTenantConfig] = useState(null);

  // Pre-load config so the gate can show the tenant logo if uploaded.
  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (c) setTenantConfig(c); })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        setError("Incorrect password");
        setSubmitting(false);
        return;
      }
      const data = await r.json();
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
    } catch (err) {
      setError("Network error: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setPassword("");
  }

  if (token) {
    return <AdminSetup token={token} onLogout={handleLogout} />;
  }

  const companyName = tenantConfig?.company?.name || "Demo";
  const logo = tenantConfig?.company?.logo;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)",
      fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      color: tokens.navy,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{ ...card, width: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          {logo ? (
            <img src={logo} alt={companyName} style={{ width: 64, height: 64, objectFit: "contain", marginBottom: 10 }} />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: 14,
              background: tokens.brandBlue, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 28, margin: "0 auto 10px",
            }}>{companyName[0] || "N"}</div>
          )}
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Admin Access</h1>
          <p style={{ fontSize: 12, color: tokens.textMuted, margin: "4px 0 0" }}>
            {companyName} configuration platform
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputBase}
            placeholder="Enter admin password"
            autoFocus
          />
          {error && (
            <div style={{
              marginTop: 12, padding: "8px 12px", borderRadius: 8,
              background: "#fef2f2", border: "1px solid #fecaca",
              color: "#dc2626", fontSize: 12,
            }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={submitting || !password}
            style={{ ...btnPrimary, width: "100%", marginTop: 16, opacity: submitting || !password ? 0.5 : 1 }}
          >{submitting ? "Verifying..." : "Sign in"}</button>
        </form>
      </div>
    </div>
  );
}
