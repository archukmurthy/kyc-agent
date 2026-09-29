/**
 * PreboardingUnavailable.jsx — shown instead of the access gate when the
 * server says pre-boarding isn't available for this tenant. Three reasons, all
 * answered by the server so the browser never has to guess:
 *   tenant_not_found      — the tenant id in the URL isn't registered
 *   tenant_inactive       — the tenant exists but is deactivated
 *   preboarding_disabled  — pre-boarding is switched off for this tenant
 *
 * Deliberately says nothing about which tenants DO exist: this is a public,
 * unauthenticated surface.
 */

import React from "react";
import { C } from "../../constants/theme";

const MESSAGES = {
  tenant_not_found: {
    title: "We don't recognise this address",
    body: "The tenant in this link doesn't exist. Check the link with whoever sent it to you.",
  },
  tenant_inactive: {
    title: "This tenant is not active",
    body: "Pre-boarding is unavailable while the tenant is deactivated. Contact your platform administrator.",
  },
  preboarding_disabled: {
    title: "Pre-boarding is not available for this tenant",
    body: "Pre-boarding hasn't been switched on here. Your platform administrator can enable it.",
  },
};

export function PreboardingUnavailable({ reason, tenantId }) {
  const copy = MESSAGES[reason] || MESSAGES.tenant_not_found;
  return (
    <div style={{
      minHeight: "100vh", background: C.background, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "40px 20px",
      fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: C.text,
    }}>
      <div style={{
        width: "100%", maxWidth: 420, background: C.surface, borderRadius: 16,
        padding: "40px 36px", border: `1px solid ${C.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.06)", textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>🚫</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px 0" }}>{copy.title}</h2>
        <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6, margin: 0 }}>{copy.body}</p>
        {tenantId && (
          <div style={{ marginTop: 18, fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>
            tenant: {tenantId}
          </div>
        )}
      </div>
    </div>
  );
}
