import React from "react";

// Rendered by App.js (KYCAgent) when getTenantId() resolves to "" — i.e. the
// URL has no ?tenant= param. The app is "3-strict": there is no default
// tenant, so a bare URL must show this neutral explainer instead of silently
// falling back to any one customer's branding. Deliberately lists no tenant
// names — this is a public, unauthenticated surface.
export default function NoTenantLanding() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const exampleUrl = `${origin}/?tenant=acme`;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: "#1a3a4a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.95)",
          borderRadius: 16,
          border: "1px solid rgba(26,58,74,0.08)",
          boxShadow: "0 10px 40px rgba(26,58,74,0.10)",
          padding: "40px 36px",
          maxWidth: 440,
          width: "100%",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            margin: "0 auto 20px",
            background: "linear-gradient(135deg,#1a3a4a,#4a9e8e)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            color: "#fff",
          }}
        >
          🏢
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>No tenant selected</h1>
        <p style={{ fontSize: 14, color: "#1a3a4a99", lineHeight: 1.6, margin: "0 0 22px" }}>
          This page serves multiple organizations, each with its own configuration. A tenant must
          be specified in the URL before onboarding can start.
        </p>
        <div
          style={{
            background: "#f5f7f6",
            border: "1px solid rgba(26,58,74,0.08)",
            borderRadius: 10,
            padding: "14px 16px",
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#1a3a4a80",
              marginBottom: 8,
            }}
          >
            Add a tenant to the URL
          </div>
          <code
            style={{
              display: "block",
              fontFamily: "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace",
              fontSize: 13,
              color: "#1a6b56",
              background: "#eef6f3",
              border: "1px solid rgba(74,158,142,0.25)",
              borderRadius: 6,
              padding: "8px 10px",
              wordBreak: "break-all",
            }}
          >
            {"?tenant=<your-tenant-id>"}
          </code>
          <div style={{ fontSize: 12, color: "#1a3a4a70", marginTop: 10, wordBreak: "break-all" }}>
            e.g. <span style={{ fontWeight: 600 }}>{exampleUrl}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
