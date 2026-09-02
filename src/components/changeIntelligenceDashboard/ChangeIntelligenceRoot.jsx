/**
 * ChangeIntelligenceRoot.jsx — internal-only gate for the dashboard. Reuses the
 * EXISTING admin access pattern (POST /api/admin-auth + sessionStorage
 * "admin_token"), so anyone already signed into /admin in this session reaches
 * the dashboard with no second prompt, and no new auth is introduced (D2).
 *
 * It only gates + renders the read-only dashboard. No writes.
 */

import React, { useState } from "react";
import ChangeIntelligenceDashboard from "./ChangeIntelligenceDashboard";
import { getTenantId } from "../../utils/tenant";

const TOKEN_KEY = "admin_token"; // same key AdminRoot uses

export default function ChangeIntelligenceRoot() {
  const [tenantId] = useState(() => getTenantId());
  const [token, setToken] = useState(() => {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; }
  });

  if (token) return <ChangeIntelligenceDashboard />;

  return <Gate tenantId={tenantId} onSuccess={(t) => {
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (_) {}
    setToken(t);
  }} />;
}

function Gate({ tenantId, onSuccess }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin-auth?tenant=${encodeURIComponent(tenantId || "demo")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId || "demo" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) { setError("Incorrect password. Please try again."); setSubmitting(false); return; }
      const data = await r.json();
      onSuccess(data.token);
    } catch (err) {
      setError("Network error: " + err.message);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", borderRadius: 14, padding: 32, width: "100%", maxWidth: 380, boxShadow: "0 10px 40px rgba(0,0,0,0.08)", border: "1px solid #e2e8f0" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#0b3d91", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 24, margin: "0 auto 12px" }}>📊</div>
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Change Intelligence</h1>
          <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>Internal — authorised personnel only</p>
        </div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", display: "block", marginBottom: 5 }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
          placeholder="Enter admin password"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }} />
        {error && <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 12 }}>{error}</div>}
        <button type="submit" disabled={submitting || !password}
          style={{ width: "100%", marginTop: 16, padding: "11px 16px", borderRadius: 8, border: "none", background: "#0b3d91", color: "#fff", fontSize: 14, fontWeight: 700, cursor: submitting || !password ? "not-allowed" : "pointer", opacity: submitting || !password ? 0.5 : 1, fontFamily: "inherit" }}>
          {submitting ? "Verifying…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
