import React, { useEffect, useMemo, useState } from "react";
import AdminHeader from "./components/AdminHeader";
import QuickActionCard from "./components/QuickActionCard";
import AdminWizard from "./AdminWizard";
import StepCompany from "./steps/StepCompany";
import StepDocuments from "./steps/StepDocuments";
import StepSources from "./steps/StepSources";
import StepSchemas from "./steps/StepSchemas";
import MiniWizardAddLicence from "./miniwizards/MiniWizardAddLicence";
import MiniWizardAddEntity from "./miniwizards/MiniWizardAddEntity";
import MiniWizardAddSchema from "./miniwizards/MiniWizardAddSchema";
import { adminColors, adminStyles } from "./adminDesign";

const PREVIEW_KEY = "preview_config";
const PREVIEW_TENANT_KEY = "preview_tenant_id";
const PREVIEW_TS_KEY = "preview_timestamp";

// Compute readiness status for each configuration area. Mirrors the spec's
// definitions; rendered both as the pill row and as the "incomplete" callout.
function computeStatus(config) {
  if (!config) return {};
  const company = !!config.company?.name;
  const licences = (config.licences || []).length > 0;
  const activeEntities = (config.entityTypes || []).filter((e) => e.active);
  const entityTypes = activeEntities.length > 0;

  let schemaCells = 0;
  let schemaDone = 0;
  activeEntities.forEach((e) => {
    (e.associatedLicenceIds || (config.licences || []).map((l) => l.id)).forEach((licId) => {
      schemaCells += 1;
      const cfg = config.schemas?.[`${e.id}:${licId}`];
      const fields = (cfg?.researchFields?.length || 0) + (cfg?.gapFields?.length || 0);
      if (fields > 0) schemaDone += 1;
    });
  });
  const schemas =
    schemaCells === 0
      ? false
      : schemaDone === schemaCells
      ? true
      : schemaDone; // numeric => partial

  const sources = (config.sourceTiers?.primary || []).length > 0;

  const documents =
    activeEntities.length > 0 &&
    activeEntities.every((e) => (config.documents?.[e.id] || []).filter((d) => d.active !== false).length > 0);

  return { company, licences, entityTypes, schemas, schemaCells, schemaDone, sources, documents };
}

export default function AdminDashboard({
  tenantConfig,
  firstLogin,
  token,
  tenantId = "nium",
  onSignOut,
  onReloadConfig,
}) {
  const [localConfig, setLocalConfig] = useState(tenantConfig);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(false);
  const [activeView, setActiveView] = useState("dashboard");
  const [showWelcome, setShowWelcome] = useState(!!firstLogin);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState(null);
  const [toast, setToast] = useState(null);
  const [wizardStartStep, setWizardStartStep] = useState(1);

  useEffect(() => {
    setLocalConfig(tenantConfig);
  }, [tenantConfig]);

  // Browser-level guard so closing the tab / navigating away with unpublished
  // changes prompts the standard "leave site?" confirmation. The message text
  // is controlled by the browser; setting returnValue is the modern API.
  useEffect(() => {
    if (!hasUnpublishedChanges) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnpublishedChanges]);

  const status = useMemo(() => computeStatus(localConfig), [localConfig]);

  // Resume target for "Run Full Setup Wizard".
  //
  // Company / documents / sources are treated as optional — they have
  // defaults and don't gate publishing. Only licences, active entity types,
  // and schemas for active matrix cells are "required". When everything
  // required is done, return 1 so the user reviews from the beginning rather
  // than landing on Publish (which would feel like the wizard pushing them
  // to re-publish).
  function firstIncompleteStep() {
    if (!status.licences) return 2;
    if (!status.entityTypes) return 3;
    if (status.schemas !== true) return 4;
    return 1;
  }

  function onConfigChange(patch) {
    setLocalConfig((prev) => ({ ...(prev || {}), ...patch }));
    setHasUnpublishedChanges(true);
  }

  function showToast(text, ok = true) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3000);
  }

  async function handlePublish() {
    if (!localConfig) return;
    setPublishing(true);
    setPublishMsg(null);
    try {
      const r = await fetch(`/api/config?tenant=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId },
        body: JSON.stringify(localConfig),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPublishMsg({ ok: true, text: `Published — v${data.version} is live` });
      setHasUnpublishedChanges(false);
      // Clear staged preview now that the same config is live — prevents an
      // open preview tab from continuing to show pre-publish state on refresh.
      clearPreviewSession();
      const cfgRes = await fetch(`/api/config?tenant=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        setLocalConfig(cfg);
      }
    } catch (err) {
      setPublishMsg({ ok: false, text: "Publish failed: " + err.message });
    } finally {
      setPublishing(false);
      setTimeout(() => setPublishMsg(null), 5000);
    }
  }

  function handlePreview() {
    if (!localConfig) return;
    try {
      // sessionStorage is inherited by the new tab when opened via window.open
      // from the same origin (modern Chrome/Firefox/Safari). Each tab gets its
      // own session, so this does not leak between unrelated tabs.
      sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(localConfig));
      sessionStorage.setItem(PREVIEW_TENANT_KEY, tenantId || "nium");
      sessionStorage.setItem(PREVIEW_TS_KEY, new Date().toISOString());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Could not write preview config:", e);
    }
    const tenantParam = tenantId && tenantId !== "nium"
      ? `&tenant=${encodeURIComponent(tenantId)}`
      : "";
    window.open(`/?preview=true${tenantParam}`, "_blank");
  }

  function clearPreviewSession() {
    try {
      sessionStorage.removeItem(PREVIEW_KEY);
      sessionStorage.removeItem(PREVIEW_TENANT_KEY);
      sessionStorage.removeItem(PREVIEW_TS_KEY);
    } catch (_) { /* ignore */ }
  }

  function goView(v) {
    setActiveView(v);
  }

  function runFullWizard() {
    setWizardStartStep(firstIncompleteStep());
    goView("wizard");
  }

  function exitToDashboard() {
    goView("dashboard");
    setWizardStartStep(1);
  }

  function miniwizardComplete(updatedConfig, message) {
    setLocalConfig(updatedConfig);
    setHasUnpublishedChanges(true);
    exitToDashboard();
    showToast("✅ " + message);
  }

  // Wizard takes over the whole viewport
  if (activeView === "wizard") {
    return (
      <AdminWizard
        localConfig={localConfig}
        onConfigChange={onConfigChange}
        onExit={exitToDashboard}
        onPublish={handlePublish}
        startAtStep={wizardStartStep}
        adminToken={token}
        tenantId={tenantId}
        onPublishSuccess={() => {
          setHasUnpublishedChanges(false);
          showToast("✅ Configuration published");
        }}
        resumed={wizardStartStep > 1}
      />
    );
  }

  // Sub-views: mini-wizards and standalone forms
  if (activeView !== "dashboard") {
    return (
      <div style={adminStyles.pageWrapper}>
        <AdminHeader
          tenantConfig={localConfig}
          tenantId={tenantId}
          hasUnpublishedChanges={hasUnpublishedChanges}
          canPublish={!!status.company && !!status.licences}
          publishing={publishing}
          onPublish={handlePublish}
          onPreview={handlePreview}
          onSignOut={onSignOut}
        />
        <div style={adminStyles.pageInner}>
          <button
            type="button"
            onClick={exitToDashboard}
            style={{ ...adminStyles.btnGhost, color: adminColors.textMuted, marginBottom: 12, fontSize: 13 }}
          >
            ← Back to Dashboard
          </button>
          {publishMsg && <PublishToast msg={publishMsg} />}
          <SubView
            view={activeView}
            config={localConfig}
            onChange={onConfigChange}
            onCompleteMini={miniwizardComplete}
            onCancelMini={exitToDashboard}
            onStandaloneSave={() => {
              showToast("✅ Saved");
              exitToDashboard();
            }}
          />
        </div>
        {toast && <Toast {...toast} />}
      </div>
    );
  }

  // Dashboard
  return (
    <div style={adminStyles.pageWrapper}>
      <AdminHeader
        tenantConfig={localConfig}
        tenantId={tenantId}
        hasUnpublishedChanges={hasUnpublishedChanges}
        canPublish={!!status.company && !!status.licences}
        publishing={publishing}
        onPublish={handlePublish}
        onPreview={handlePreview}
        onSignOut={onSignOut}
      />

      {showWelcome && (
        <WelcomeModal
          onWizard={() => {
            setShowWelcome(false);
            runFullWizard();
          }}
          onDashboard={() => setShowWelcome(false)}
        />
      )}

      <div style={adminStyles.pageInner}>
        {publishMsg && <PublishToast msg={publishMsg} />}

        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            Welcome back, {localConfig?.company?.name || "there"}
          </h2>
          <div style={{ fontSize: 13, color: adminColors.textMuted, marginTop: 4 }}>
            {new Date().toLocaleString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        </div>

        <ConfigStatusCard status={status} onContinue={runFullWizard} />

        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          <QuickActionCard icon="🔑" title="+ Add Licence" body="Add a new regulatory licence and configure its schemas" onClick={() => goView("add-licence")} />
          <QuickActionCard icon="🏷" title="+ Add Entity Type" body="Define a new type of entity you want to onboard" onClick={() => goView("add-entity")} />
          <QuickActionCard icon="📝" title="+ Add Field Schema" body="Configure fields for a specific entity type and licence combination" onClick={() => goView("add-schema")} />
          <QuickActionCard icon="⚙" title="✏ Edit Company Setup" body="Update branding, URLs and contact details" onClick={() => goView("company")} />
          <QuickActionCard icon="📄" title="Document Collection" body="Configure which documents you collect per entity type" onClick={() => goView("documents")} />
          <QuickActionCard icon="🔍" title="Source Classification" body="Define primary and secondary sources for research" onClick={() => goView("sources")} />
        </div>

        <button
          type="button"
          onClick={runFullWizard}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "14px 18px",
            borderRadius: 10,
            background: "#fff",
            border: `1.5px solid ${adminColors.niumBlue}`,
            color: adminColors.niumBlue,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🧭 Run Full Setup Wizard
        </button>

        <RecentActivity config={localConfig} />
      </div>
      {toast && <Toast {...toast} />}
    </div>
  );
}

function ConfigStatusCard({ status, onContinue }) {
  const items = [
    { key: "company",     label: "Company",     ok: status.company },
    { key: "licences",    label: "Licences",    ok: status.licences },
    { key: "entityTypes", label: "Entity Types", ok: status.entityTypes },
    {
      key: "schemas",
      label:
        status.schemas === true
          ? "Schemas"
          : `${status.schemaDone || 0} of ${status.schemaCells || 0} schemas`,
      ok: status.schemas === true,
    },
    { key: "documents",   label: "Documents",   ok: status.documents },
    { key: "sources",     label: "Sources",     ok: status.sources },
  ];
  const allOk = items.every((i) => i.ok);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        border: `1px solid ${adminColors.border}`,
        padding: 18,
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((i) => (
          <span key={i.key} style={adminStyles.statusBadge(i.ok ? "complete" : "incomplete")}>
            {i.ok ? "✅" : "⚠"} {i.label}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 13, color: allOk ? adminColors.statusComplete : adminColors.textMuted }}>
          {allOk
            ? "✅ All configuration complete"
            : "Your configuration has gaps — some onboarding flows may not work correctly."}
        </div>
        {!allOk && (
          <button type="button" onClick={onContinue} style={adminStyles.btnPrimary}>
            Continue Setup →
          </button>
        )}
      </div>
    </div>
  );
}

function SubView({ view, config, onChange, onCompleteMini, onCancelMini, onStandaloneSave }) {
  if (view === "company") {
    return (
      <>
        <StepCompany config={config} onChange={onChange} isStandalone />
        <StandaloneSaveBar onSave={onStandaloneSave} />
      </>
    );
  }
  if (view === "documents") {
    return (
      <>
        <StepDocuments config={config} onChange={onChange} isStandalone />
        <StandaloneSaveBar onSave={onStandaloneSave} />
      </>
    );
  }
  if (view === "sources") {
    return (
      <>
        <StepSources config={config} onChange={onChange} isStandalone />
        <StandaloneSaveBar onSave={onStandaloneSave} />
      </>
    );
  }
  if (view === "schemas") {
    return (
      <>
        <StepSchemas config={config} onChange={onChange} isStandalone />
        <StandaloneSaveBar onSave={onStandaloneSave} />
      </>
    );
  }
  if (view === "add-licence") {
    return <MiniWizardAddLicence config={config} onComplete={onCompleteMini} onCancel={onCancelMini} />;
  }
  if (view === "add-entity") {
    return <MiniWizardAddEntity config={config} onComplete={onCompleteMini} onCancel={onCancelMini} />;
  }
  if (view === "add-schema") {
    return <MiniWizardAddSchema config={config} onComplete={onCompleteMini} onCancel={onCancelMini} />;
  }
  return null;
}

function StandaloneSaveBar({ onSave }) {
  return (
    <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
      <button type="button" onClick={onSave} style={adminStyles.btnPrimary}>
        Save Changes
      </button>
    </div>
  );
}

function WelcomeModal({ onWizard, onDashboard }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 32,
          maxWidth: 560,
          width: "100%",
          boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 8 }}>🧭</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Welcome to your onboarding platform
          </h2>
          <p style={{ fontSize: 14, color: adminColors.textMuted, margin: "10px 0 0" }}>
            Let&apos;s get you set up. We&apos;ll guide you through configuring your onboarding flows —
            it takes about 10 minutes and you can pause at any time.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
          <WelcomeOption
            recommended
            icon="🧭"
            title="Start guided setup"
            body="Walk through all configuration steps in order. Best for first-time setup."
            cta="Start Setup Wizard →"
            ctaStyle={adminStyles.btnPrimary}
            onClick={onWizard}
          />
          <WelcomeOption
            icon="🗂"
            title="Explore the dashboard"
            body="Browse configuration options at your own pace. You can run the wizard anytime."
            cta="Go to Dashboard"
            ctaStyle={adminStyles.btnSecondary}
            onClick={onDashboard}
          />
        </div>

        <div style={{ marginTop: 18, fontSize: 12, color: adminColors.textMuted, textAlign: "center" }}>
          Your current configuration is pre-loaded with Nium defaults — nothing is blank.
        </div>
      </div>
    </div>
  );
}

function WelcomeOption({ recommended, icon, title, body, cta, ctaStyle, onClick }) {
  return (
    <div
      style={{
        border: `1.5px solid ${recommended ? adminColors.niumBlue : adminColors.border}`,
        background: recommended ? "rgba(11,61,145,0.04)" : "#fff",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 3 }}>{body}</div>
      </div>
      <button type="button" onClick={onClick} style={ctaStyle}>
        {cta}
      </button>
    </div>
  );
}

function PublishToast({ msg }) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 14px",
        borderRadius: 8,
        background: msg.ok ? adminColors.statusCompleteBg : "#fef2f2",
        color: msg.ok ? adminColors.statusComplete : adminColors.danger,
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${msg.ok ? adminColors.statusComplete : adminColors.danger}40`,
      }}
    >
      {msg.text}
    </div>
  );
}

function Toast({ text, ok }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 250,
        padding: "12px 18px",
        background: ok ? adminColors.statusComplete : adminColors.danger,
        color: "#fff",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
        maxWidth: 360,
      }}
    >
      {text}
    </div>
  );
}

function RecentActivity({ config }) {
  const items = [];
  if (config?._publishedAt) {
    items.push({ when: config._publishedAt, what: `Published v${config._version || 1}` });
  } else if (config?._seededAt) {
    items.push({ when: config._seededAt, what: "Seeded default configuration" });
  }
  if (config?._rolledBackFrom) {
    items.unshift({ when: config._publishedAt, what: `Rolled back from v${config._rolledBackFrom}` });
  }

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: adminColors.textMuted, marginBottom: 8 }}>
        Recent activity
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: adminColors.textMuted }}>No recent activity</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {items.map((it, i) => (
            <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${adminColors.border}` }}>
              <span style={{ fontSize: 13 }}>{it.what}</span>
              <span style={{ fontSize: 12, color: adminColors.textMuted }}>
                {new Date(it.when).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
