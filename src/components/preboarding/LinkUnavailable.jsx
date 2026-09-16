/**
 * LinkUnavailable.jsx — shown to a customer whose onboarding link cannot be
 * used. The server decides why; this only chooses the words. It deliberately
 * reveals nothing about the dossier or the tenant's other applications.
 */

import React from "react";

const MESSAGES = {
  link_expired: {
    title: "This link has expired",
    body: "Onboarding links are valid for 30 days. Ask your onboarding contact to send you a new one.",
  },
  link_revoked: {
    title: "This link is no longer active",
    body: "It was replaced or withdrawn. Ask your onboarding contact to send you a new one.",
  },
  legacy: {
    title: "This link is no longer valid",
    body: "We've upgraded how onboarding links work. Ask your onboarding contact to send you a new one.",
  },
  invalid: {
    title: "This link isn't valid",
    body: "Check that you opened the full link from your email, or ask your onboarding contact to send you a new one.",
  },
};

export function LinkUnavailable({ reason }) {
  const copy = MESSAGES[reason] || MESSAGES.invalid;
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 20px", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", color: "#1a3a4a",
    }}>
      <div style={{
        width: "100%", maxWidth: 440, background: "#fff", borderRadius: 16,
        padding: "40px 36px", border: "1px solid rgba(26,58,74,0.08)",
        boxShadow: "0 10px 40px rgba(26,58,74,0.10)", textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 18 }}>🔗</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>{copy.title}</h1>
        <p style={{ fontSize: 14, color: "#1a3a4a99", lineHeight: 1.6, margin: 0 }}>{copy.body}</p>
      </div>
    </div>
  );
}
