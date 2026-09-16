/**
 * PreboardingGate.jsx — the analyst access gate, screen 1 of pre-boarding.
 *
 * The password is checked by the SERVER (POST /api/preboarding-auth). It used
 * to be compared in the browser against a constant in the bundle, which gated
 * the screen but not the data. The gate also asks the server whether
 * pre-boarding is available for this tenant at all (GET) so an unknown,
 * deactivated or switched-off tenant sees an explanation instead of a password
 * box it could never satisfy.
 *
 * On success the server returns the tenant IT verified; the caller stores that
 * and uses it for dossier saves and invite links.
 */

import React from "react";
import { C } from "../../constants/theme";
import { PreboardingUnavailable } from "./PreboardingUnavailable";

export function PreboardingGate({ tenantId, onUnlocked, trackEvent }) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [availability, setAvailability] = React.useState(null); // null = loading

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/preboarding-auth?tenant=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
        const data = await r.json();
        if (!cancelled) setAvailability(data);
      } catch (_) {
        if (!cancelled) setAvailability({ available: false, reason: "tenant_not_found", companyName: "" });
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function handlePasswordSubmit() {
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`/api/preboarding-auth?tenant=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) {
        trackEvent("preboarding_password_failed", { attemptedAt: new Date().toISOString() });
        setError("Incorrect access code. Please try again.");
        setPassword("");
        setSubmitting(false);
        return;
      }
      trackEvent("preboarding_password_correct", { unlockedAt: new Date().toISOString() });
      onUnlocked(data.token, data.tenantId);
    } catch (err) {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (availability === null) return null;              // brief: the probe is one request
  if (!availability.available) {
    return <PreboardingUnavailable reason={availability.reason} tenantId={tenantId} />;
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: C.background,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
      fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      color: C.text,
    }}>
      <div style={{
        width: "100%", maxWidth: 400, background: C.surface, borderRadius: 16,
        padding: "40px 36px", border: `1px solid ${C.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.06)", textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>🔒</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "0 0 8px 0" }}>
          Pre-boarding Agent
        </h2>
        <p style={{ fontSize: 14, color: C.textSec, marginBottom: 28, lineHeight: 1.5 }}>
          This feature is currently under development and restricted to authorised access only.
        </p>

        <div style={{ marginBottom: 16 }}>
          <input
            type="password"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              setError("");
            }}
            onKeyDown={e => { if (e.key === "Enter") handlePasswordSubmit(); }}
            placeholder="Enter access code"
            autoFocus
            style={{
              width: "100%", padding: "12px 16px", fontSize: 15,
              border: `1.5px solid ${error ? C.error : C.border}`,
              borderRadius: 8, outline: "none", fontFamily: "inherit",
              background: C.surface, color: C.text, boxSizing: "border-box",
              textAlign: "center", letterSpacing: "0.2em",
            }}
          />
          {error && (
            <p style={{ fontSize: 12, color: C.error, marginTop: 6, textAlign: "center" }}>
              {error}
            </p>
          )}
        </div>

        <button
          onClick={handlePasswordSubmit}
          disabled={submitting}
          style={{
            width: "100%", padding: "12px 0", background: "#7C3AED", color: "#fff",
            border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
            fontFamily: "inherit", cursor: submitting ? "default" : "pointer", marginBottom: 16,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          Access Pre-boarding Agent
        </button>

        {/* PARKED - "← Back to agent selection" button. Its destination is the
            agent-selection screen (renderLandingPage in App.js), which is itself
            currently parked. RE-ENABLE this together with renderLandingPage when
            the agent-selection screen is restored. */}
      </div>
    </div>
  );
}
