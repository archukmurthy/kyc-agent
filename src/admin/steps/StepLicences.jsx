import React, { useEffect, useState } from "react";
import WizardCard from "../components/WizardCard";
import { adminColors, adminStyles } from "../adminDesign";
import { COUNTRIES, flagFor } from "../countries";

// Note: the persisted config uses `isPrimary` to mark the default licence
// (kept for compatibility with src/App.js). The UI labels this as "Default"
// because that's what the spec and admins call it.
const BLANK_LICENCE = () => ({
  id: "lic_" + Date.now(),
  jurisdictionCode: "GB",
  jurisdictionName: "United Kingdom",
  licenceType: "",
  licenceNumber: "",
  regulatoryAuthority: "",
  countriesCovered: [],
  isPrimary: false,
});

export default function StepLicences({
  config,
  onChange,
  isStandalone = false,
  addMode = false,
}) {
  const [licences, setLicences] = useState(config?.licences || []);
  const [routingPolicy, setRoutingPolicy] = useState(config?.routingPolicy || "regional");
  const [showChangeDefault, setShowChangeDefault] = useState(false);
  const [pendingDefaultId, setPendingDefaultId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(addMode);
  const [draft, setDraft] = useState(BLANK_LICENCE());
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setLicences(config?.licences || []);
    setRoutingPolicy(config?.routingPolicy || "regional");
  }, [config?._version, config?.licences, config?.routingPolicy]);

  function pushLicences(next) {
    setLicences(next);
    onChange({ licences: next });
  }

  function pushRouting(p) {
    setRoutingPolicy(p);
    onChange({ routingPolicy: p });
  }

  function updateLicence(id, patch) {
    pushLicences(licences.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function deleteLicence(id) {
    const lic = licences.find((l) => l.id === id);
    if (!lic) return;
    if (lic.isPrimary) {
      alert("Set another licence as default first.");
      return;
    }
    if (!window.confirm(`Delete licence "${lic.jurisdictionName}"? This cannot be undone.`)) return;
    pushLicences(licences.filter((l) => l.id !== id));
    flashNotice("Licence deleted");
  }

  function confirmChangeDefault() {
    if (!pendingDefaultId) return;
    pushLicences(licences.map((l) => ({ ...l, isPrimary: l.id === pendingDefaultId })));
    setShowChangeDefault(false);
    setPendingDefaultId(null);
    flashNotice("Default licence updated");
  }

  function addLicence() {
    if (!draft.jurisdictionCode || !draft.licenceType) {
      alert("Jurisdiction and licence type are required.");
      return;
    }
    const newLic = {
      ...draft,
      id: draft.id || "lic_" + Date.now(),
      jurisdictionName:
        COUNTRIES.find((c) => c.code === draft.jurisdictionCode)?.name || draft.jurisdictionCode,
    };
    const next = [...licences, newLic];
    pushLicences(next);
    setShowAddForm(false);
    setDraft(BLANK_LICENCE());
    flashNotice(
      isStandalone || addMode
        ? "✅ Licence added"
        : "✅ Licence added — configure its schemas in Step 4"
    );
  }

  function flashNotice(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  const defaultLicence = licences.find((l) => l.isPrimary) || licences[0] || null;

  return (
    <WizardCard
      title="Licences"
      subtitle="Add the licences you hold and tell us which countries each one covers."
    >
      {/* Routing policy */}
      <Section title="Routing Policy" subtitle="How do we decide which licence schema applies to each customer?">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <RoutingCard
            selected={routingPolicy === "regional"}
            icon="🗺"
            title="Regional"
            recommended
            body="Route customers to the licence that covers their registered country. Customers in uncovered countries use the default licence."
            onClick={() => pushRouting("regional")}
          />
          <RoutingCard
            selected={routingPolicy === "global"}
            icon="🌍"
            title="Global"
            body="All customers use the default licence schema regardless of their country."
            onClick={() => pushRouting("global")}
          />
        </div>
      </Section>

      {/* Default licence header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: adminColors.textMuted }}>
          Default Licence
          {defaultLicence && (
            <span style={{ marginLeft: 8, textTransform: "none", color: adminColors.text, fontWeight: 600, letterSpacing: 0 }}>
              {flagFor(defaultLicence.jurisdictionCode)} {defaultLicence.jurisdictionName}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setPendingDefaultId(defaultLicence?.id || null);
            setShowChangeDefault(true);
          }}
          style={{ ...adminStyles.btnSecondary, padding: "6px 12px", fontSize: 12 }}
          disabled={licences.length < 2}
        >
          Change Default →
        </button>
      </div>

      {notice && (
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: adminColors.statusCompleteBg, color: adminColors.statusComplete, fontSize: 12, fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {/* Licence list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {licences.map((lic) => (
          <LicenceCard
            key={lic.id}
            licence={lic}
            expanded={expandedId === lic.id}
            onToggle={() => setExpandedId(expandedId === lic.id ? null : lic.id)}
            onPatch={(patch) => updateLicence(lic.id, patch)}
            onDelete={() => deleteLicence(lic.id)}
          />
        ))}
        {!licences.length && (
          <div style={{ padding: 16, border: `1px dashed ${adminColors.border}`, borderRadius: 10, color: adminColors.textMuted, fontSize: 13, textAlign: "center" }}>
            No licences yet — add one below.
          </div>
        )}
      </div>

      {/* Add licence */}
      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "12px 16px",
            border: `1.5px dashed ${adminColors.borderStrong}`,
            background: "#fff",
            borderRadius: 10,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 700,
            color: adminColors.niumBlue,
          }}
        >
          + Add Licence
        </button>
      ) : (
        <div style={{ marginTop: 16, padding: 16, border: `1px solid ${adminColors.border}`, borderRadius: 10, background: adminColors.wizardBg }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Add a new licence</div>
          <LicenceFields
            licence={draft}
            onPatch={(p) => setDraft({ ...draft, ...p })}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="button" onClick={addLicence} style={adminStyles.btnPrimary}>
              Add Licence
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setDraft(BLANK_LICENCE());
              }}
              style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Change default modal */}
      {showChangeDefault && (
        <Modal onClose={() => setShowChangeDefault(false)}>
          <h3 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 6px" }}>Change Default Licence</h3>
          <p style={{ fontSize: 13, color: adminColors.textMuted, margin: "0 0 14px" }}>
            The default licence is used when a customer&apos;s country is not covered by any other licence.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {licences.map((l) => (
              <label
                key={l.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  border: `1px solid ${pendingDefaultId === l.id ? adminColors.niumBlue : adminColors.border}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: pendingDefaultId === l.id ? "rgba(11,61,145,0.04)" : "#fff",
                }}
              >
                <input
                  type="radio"
                  name="default-licence"
                  checked={pendingDefaultId === l.id}
                  onChange={() => setPendingDefaultId(l.id)}
                />
                <span style={{ fontSize: 14 }}>
                  {flagFor(l.jurisdictionCode)} {l.jurisdictionName}
                  {l.regulatoryAuthority ? ` (${l.regulatoryAuthority})` : ""}
                </span>
                {l.isPrimary && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: adminColors.textMuted }}>(current)</span>
                )}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => setShowChangeDefault(false)}
              style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}
            >
              Cancel
            </button>
            <button type="button" onClick={confirmChangeDefault} style={adminStyles.btnPrimary} disabled={!pendingDefaultId}>
              Set as Default
            </button>
          </div>
        </Modal>
      )}
    </WizardCard>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: adminColors.text }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: adminColors.textMuted, marginBottom: 12, marginTop: 2 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function RoutingCard({ selected, icon, title, body, recommended, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: 14,
        borderRadius: 10,
        border: `2px solid ${selected ? adminColors.niumBlue : adminColors.border}`,
        background: selected ? "rgba(11,61,145,0.04)" : "#fff",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 18 }}>{icon}</div>
        {recommended && (
          <span style={{ fontSize: 10, fontWeight: 700, color: adminColors.niumBlue, background: "rgba(11,61,145,0.1)", padding: "2px 8px", borderRadius: 99 }}>
            RECOMMENDED
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: adminColors.text }}>{title}</div>
      <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 4, lineHeight: 1.45 }}>{body}</div>
    </button>
  );
}

function LicenceCard({ licence, expanded, onToggle, onPatch, onDelete }) {
  const isDefault = !!licence.isPrimary;
  return (
    <div
      style={{
        border: `1px solid ${adminColors.border}`,
        borderLeft: isDefault ? `3px solid ${adminColors.niumBlue}` : `1px solid ${adminColors.border}`,
        borderRadius: 10,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>{flagFor(licence.jurisdictionCode)}</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {licence.jurisdictionName}
              {licence.regulatoryAuthority ? ` (${licence.regulatoryAuthority})` : ""}
            </span>
            {isDefault && (
              <span style={{ ...adminStyles.statusBadge("complete"), padding: "2px 8px", fontSize: 10 }}>DEFAULT</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 3 }}>
            {licence.licenceType || "—"}
            {Array.isArray(licence.countriesCovered) && licence.countriesCovered.length > 0
              ? ` · covers ${licence.countriesCovered.length} countr${licence.countriesCovered.length === 1 ? "y" : "ies"}`
              : isDefault
              ? " · catch-all (no countries listed)"
              : " · no countries assigned"}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          style={{ ...adminStyles.btnGhost, color: adminColors.niumBlue, fontWeight: 700 }}
        >
          {expanded ? "Close ▴" : "Edit ▾"}
        </button>
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${adminColors.border}`, padding: 16, background: adminColors.wizardBg }}>
          <LicenceFields licence={licence} onPatch={onPatch} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDefault}
              style={{
                background: "transparent",
                border: "none",
                color: isDefault ? adminColors.textMuted : adminColors.danger,
                fontSize: 12,
                fontWeight: 600,
                cursor: isDefault ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
              title={isDefault ? "Set another licence as default first" : "Delete this licence"}
            >
              Delete licence
            </button>
            <button type="button" onClick={onToggle} style={adminStyles.btnSecondary}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LicenceFields({ licence, onPatch }) {
  function toggleCountry(code) {
    const next = new Set(licence.countriesCovered || []);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onPatch({ countriesCovered: Array.from(next) });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div>
        <label style={adminStyles.label}>Jurisdiction Country</label>
        <select
          value={licence.jurisdictionCode || ""}
          onChange={(e) => {
            const code = e.target.value;
            onPatch({
              jurisdictionCode: code,
              jurisdictionName: COUNTRIES.find((c) => c.code === code)?.name || code,
            });
          }}
          style={adminStyles.input}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={adminStyles.label}>Regulatory Authority</label>
        <input
          type="text"
          value={licence.regulatoryAuthority || ""}
          placeholder="e.g. FCA, MAS"
          onChange={(e) => onPatch({ regulatoryAuthority: e.target.value })}
          style={adminStyles.input}
        />
      </div>
      <div>
        <label style={adminStyles.label}>Licence Type</label>
        <input
          type="text"
          value={licence.licenceType || ""}
          placeholder="e.g. Payment Institution, EMI, Bank"
          onChange={(e) => onPatch({ licenceType: e.target.value })}
          style={adminStyles.input}
        />
      </div>
      <div>
        <label style={adminStyles.label}>Licence Number (optional)</label>
        <input
          type="text"
          value={licence.licenceNumber || ""}
          onChange={(e) => onPatch({ licenceNumber: e.target.value })}
          style={adminStyles.input}
        />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={adminStyles.label}>Countries Covered</label>
        <div style={adminStyles.helper}>
          Customers registered in these countries will use this licence&apos;s schemas. Leave empty to use as catch-all (only valid for the default licence).
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 8,
            maxHeight: 180,
            overflowY: "auto",
            padding: 8,
            border: `1px solid ${adminColors.border}`,
            borderRadius: 8,
            background: "#fff",
          }}
        >
          {COUNTRIES.map((c) => {
            const on = (licence.countriesCovered || []).includes(c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => toggleCountry(c.code)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${on ? adminColors.niumBlue : adminColors.border}`,
                  background: on ? adminColors.niumBlue : "#fff",
                  color: on ? "#fff" : adminColors.text,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {flagFor(c.code)} {c.code}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 420,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
