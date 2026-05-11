import React, { useState, useEffect, useMemo, useCallback } from "react";
import { tokens, btnPrimary, btnSecondary } from "./styles";
import CompanyModule from "./modules/CompanyModule";
import LicencesModule from "./modules/LicencesModule";
import EntityTypesModule from "./modules/EntityTypesModule";
import SchemasModule from "./modules/SchemasModule";
import SourcesModule from "./modules/SourcesModule";
import DocumentsModule from "./modules/DocumentsModule";
import ReviewModule from "./modules/ReviewModule";

const MODULES = [
  { id: "company", icon: "🏢", label: "Company Setup", Component: CompanyModule },
  { id: "licences", icon: "🛡", label: "Licences", Component: LicencesModule },
  { id: "entityTypes", icon: "🧩", label: "Entity Types", Component: EntityTypesModule },
  { id: "schemas", icon: "📋", label: "Field Schemas", Component: SchemasModule },
  { id: "sources", icon: "🔍", label: "Source Classification", Component: SourcesModule },
  { id: "documents", icon: "📄", label: "Document Collection", Component: DocumentsModule },
  { id: "review", icon: "🚀", label: "Review & Publish", Component: ReviewModule },
];

const PREVIEW_KEY = "preview_config";

export default function AdminSetup({ token, onLogout }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("company");
  const [savedModules, setSavedModules] = useState(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null); // { ok, message }
  const [versions, setVersions] = useState([]);

  // Load config on mount.
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => { setConfig(cfg); setLoading(false); })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("config load failed", err);
        setLoading(false);
      });
  }, []);

  // Load version history (admin-only — uses PUT verb on the same endpoint).
  // Wrapped in useCallback so its identity is stable across renders.
  const loadVersions = useCallback(() => {
    fetch("/api/config", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setVersions(data.versions || []))
      .catch(() => setVersions([]));
  }, [token]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  function patchConfig(slice) {
    setConfig((prev) => ({ ...prev, ...slice }));
  }

  function markSaved(moduleId) {
    setSavedModules((prev) => {
      const next = new Set(prev);
      next.add(moduleId);
      return next;
    });
  }

  async function handleReset() {
    if (!window.confirm("Reset to default Nium config?\n\nThis wipes the live config AND every archived version for this tenant. The admin UI will reload with the seeded defaults.")) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const r = await fetch("/api/config", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      // Pull the freshly-seeded default config back.
      const cfgRes = await fetch("/api/config", { cache: "no-store" });
      const cfg = await cfgRes.json();
      setConfig(cfg);
      setSavedModules(new Set());
      setPublishResult({ ok: true, message: "Reset to defaults — Nium config is live" });
      loadVersions();
    } catch (err) {
      setPublishResult({ ok: false, message: "Reset failed: " + err.message });
    } finally {
      setPublishing(false);
    }
  }

  async function handlePublish() {
    if (!config) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const r = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPublishResult({ ok: true, message: `Published successfully — Version ${data.version} is now live` });
      loadVersions();
      // Reload the canonical config so _version reflects what we just published.
      const cfgRes = await fetch("/api/config");
      const cfg = await cfgRes.json();
      setConfig(cfg);
    } catch (err) {
      setPublishResult({ ok: false, message: err.message });
    } finally {
      setPublishing(false);
    }
  }

  function handlePreview() {
    if (!config) return;
    try {
      // localStorage so the new tab can read it regardless of how it was
      // opened (sessionStorage isn't reliably inherited across tabs).
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(config));
      localStorage.setItem(PREVIEW_KEY + "_ts", String(Date.now()));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Could not write preview config to localStorage", e);
    }
    window.open("/preview", "_blank");
  }

  const activeModule = useMemo(() => MODULES.find((m) => m.id === active), [active]);

  if (loading || !config) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      }}>
        <div style={{ textAlign: "center", color: tokens.navy }}>
          <div style={{
            width: 36, height: 36, border: "3px solid rgba(11,61,145,0.15)",
            borderTopColor: tokens.niumBlue, borderRadius: "50%", margin: "0 auto 12px",
            animation: "spin 0.9s linear infinite",
          }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Loading configuration...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const Module = activeModule.Component;

  return (
    <div style={{
      minHeight: "100vh", display: "flex",
      fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      background: "#f4f8f7",
      color: tokens.navy,
    }}>
      {/* Sidebar */}
      <aside style={{
        width: 240, flex: "0 0 240px",
        background: tokens.niumBlue,
        color: "#fff",
        padding: "24px 0",
        position: "sticky", top: 0, alignSelf: "flex-start", height: "100vh",
        overflowY: "auto",
      }}>
        <div style={{ padding: "0 22px 18px", borderBottom: "1px solid rgba(255,255,255,0.12)", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.7 }}>
            Admin Console
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{config.company?.name || "Nium"}</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>Tenant: {config._tenantId} · v{config._version}</div>
        </div>

        <nav>
          {MODULES.map((m, i) => {
            const isActive = m.id === active;
            const isSaved = savedModules.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => setActive(m.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "11px 22px",
                  background: isActive ? "#fff" : "transparent",
                  color: isActive ? tokens.niumBlue : "#fff",
                  borderLeft: isActive ? "3px solid #fff" : "3px solid transparent",
                  borderTop: 0, borderRight: 0, borderBottom: 0,
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ width: 18 }}>{m.icon}</span>
                <span style={{ flex: 1 }}>{i + 1}. {m.label}</span>
                {isSaved && <span style={{ color: tokens.teal, fontWeight: 700 }}>✓</span>}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: "22px", marginTop: 28, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
          <button
            onClick={onLogout}
            style={{ background: "transparent", border: "none", color: "#fff", opacity: 0.75, fontSize: 12, cursor: "pointer", padding: 0 }}
          >Log out →</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: "0", display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 32px", background: "#fff",
          borderBottom: "1px solid rgba(26,58,74,0.08)",
          position: "sticky", top: 0, zIndex: 5,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.teal }}>
              {activeModule.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>Configure your KYC onboarding flow</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {publishResult && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: publishResult.ok ? tokens.teal : tokens.danger,
                marginRight: 6,
              }}>{publishResult.message}</span>
            )}
            <button
              onClick={handleReset}
              disabled={publishing}
              title="Wipe stored config and re-seed Nium defaults"
              style={{ ...btnSecondary, color: tokens.danger, borderColor: tokens.danger, opacity: publishing ? 0.6 : 1 }}
            >↺ Reset to default</button>
            <button onClick={handlePreview} style={btnSecondary}>👁 Preview</button>
            <button onClick={handlePublish} disabled={publishing} style={{ ...btnPrimary, opacity: publishing ? 0.6 : 1 }}>
              {publishing ? "Publishing…" : "Publish"}
            </button>
          </div>
        </div>

        <div style={{ padding: "28px 32px", maxWidth: 1080 }}>
          <Module
            config={config}
            patchConfig={patchConfig}
            markSaved={() => markSaved(active)}
            goTo={setActive}
            versions={versions}
            token={token}
          />
        </div>
      </main>
    </div>
  );
}
