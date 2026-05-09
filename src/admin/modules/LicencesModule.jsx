import React, { useState, useEffect } from "react";
import { card, label, inputBase, btnPrimary, btnDanger, sectionTitle, sectionSub, tokens } from "../styles";

function LicenceCard({ lic, onChange, onDelete, onSetPrimary, deletable }) {
  function set(key, value) { onChange({ ...lic, [key]: value }); }

  return (
    <div style={{ ...card, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="radio"
            checked={!!lic.isPrimary}
            onChange={onSetPrimary}
            style={{ accentColor: tokens.niumBlue }}
            title="Make this the primary licence"
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {lic.isPrimary ? "Primary licence" : "Secondary licence"}
          </span>
        </div>
        <button
          onClick={onDelete}
          disabled={!deletable}
          style={{ ...btnDanger, padding: "6px 12px", fontSize: 11, opacity: deletable ? 1 : 0.4, cursor: deletable ? "pointer" : "not-allowed" }}
        >Delete</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={label}>Licence ID</label>
          <input value={lic.id || ""} onChange={(e) => set("id", e.target.value)} style={inputBase} placeholder="GB" />
        </div>
        <div>
          <label style={label}>Jurisdiction code</label>
          <input value={lic.jurisdictionCode || ""} onChange={(e) => set("jurisdictionCode", e.target.value)} style={inputBase} placeholder="GB" />
        </div>
        <div>
          <label style={label}>Jurisdiction name</label>
          <input value={lic.jurisdictionName || ""} onChange={(e) => set("jurisdictionName", e.target.value)} style={inputBase} placeholder="United Kingdom" />
        </div>
        <div>
          <label style={label}>Regulatory authority</label>
          <input value={lic.regulatoryAuthority || ""} onChange={(e) => set("regulatoryAuthority", e.target.value)} style={inputBase} placeholder="FCA" />
        </div>
        <div>
          <label style={label}>Licence type</label>
          <input value={lic.licenceType || ""} onChange={(e) => set("licenceType", e.target.value)} style={inputBase} placeholder="Payment Institution" />
        </div>
        <div>
          <label style={label}>Licence number</label>
          <input value={lic.licenceNumber || ""} onChange={(e) => set("licenceNumber", e.target.value)} style={inputBase} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>Countries covered (comma-separated ISO codes — empty = catch-all)</label>
          <input
            value={(lic.countriesCovered || []).join(", ")}
            onChange={(e) => set("countriesCovered", e.target.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))}
            style={inputBase}
            placeholder="GB, IE"
          />
        </div>
      </div>
    </div>
  );
}

export default function LicencesModule({ config, patchConfig, markSaved }) {
  const [licences, setLicences] = useState(config.licences || []);
  const [routingPolicy, setRoutingPolicy] = useState(config.routingPolicy || "regional");
  const [saved, setSaved] = useState(false);

  useEffect(() => { setLicences(config.licences || []); }, [config.licences]);
  useEffect(() => { setRoutingPolicy(config.routingPolicy || "regional"); }, [config.routingPolicy]);

  function update(idx, next) {
    setLicences((prev) => prev.map((l, i) => i === idx ? next : l));
    setSaved(false);
  }

  function addLicence() {
    setLicences((prev) => [...prev, {
      id: "NEW", jurisdictionCode: "", jurisdictionName: "",
      licenceType: "", licenceNumber: "", regulatoryAuthority: "",
      countriesCovered: [], isPrimary: false,
    }]);
    setSaved(false);
  }

  function deleteLicence(idx) {
    if (licences.length <= 1) return;
    if (!window.confirm("Delete this licence? Schemas using this licence will become unreachable.")) return;
    setLicences((prev) => prev.filter((_, i) => i !== idx));
    setSaved(false);
  }

  function setPrimary(idx) {
    setLicences((prev) => prev.map((l, i) => ({ ...l, isPrimary: i === idx })));
    setSaved(false);
  }

  function handleSave() {
    // Ensure exactly one primary.
    const hasPrimary = licences.some((l) => l.isPrimary);
    const next = hasPrimary ? licences : licences.map((l, i) => ({ ...l, isPrimary: i === 0 }));
    patchConfig({ licences: next, routingPolicy });
    markSaved();
    setSaved(true);
  }

  return (
    <div>
      <h2 style={sectionTitle}>Licences</h2>
      <p style={sectionSub}>Each licence represents a market where you're authorised to onboard customers. The primary licence acts as the catch-all for any country not explicitly covered.</p>

      <div style={card}>
        <label style={label}>Routing policy</label>
        <div style={{ display: "flex", gap: 18, marginTop: 6 }}>
          {[
            { v: "regional", title: "Regional", sub: "Route by customer's registered country to the matching licence" },
            { v: "global", title: "Global", sub: "All customers use the primary licence regardless of country" },
          ].map((o) => (
            <label key={o.v} style={{
              flex: 1, display: "flex", gap: 10, padding: 14, borderRadius: 10, cursor: "pointer",
              background: routingPolicy === o.v ? "#f0f3f8" : "transparent",
              border: `2px solid ${routingPolicy === o.v ? tokens.niumBlue : tokens.border}`,
            }}>
              <input
                type="radio" name="routing"
                checked={routingPolicy === o.v}
                onChange={() => { setRoutingPolicy(o.v); setSaved(false); }}
                style={{ marginTop: 3, accentColor: tokens.niumBlue }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{o.title}</div>
                <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>{o.sub}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {licences.map((lic, i) => (
        <LicenceCard
          key={i}
          lic={lic}
          onChange={(next) => update(i, next)}
          onDelete={() => deleteLicence(i)}
          onSetPrimary={() => setPrimary(i)}
          deletable={licences.length > 1}
        />
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <button onClick={addLicence} style={{ ...btnPrimary, background: tokens.teal }}>+ Add Licence</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ color: tokens.teal, fontSize: 12, fontWeight: 600 }}>✓ Saved locally</span>}
          <button onClick={handleSave} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  );
}
