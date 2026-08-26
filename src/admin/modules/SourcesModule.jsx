import React, { useState, useEffect } from "react";
import { card, inputBase, btnPrimary, btnDanger, sectionTitle, sectionSub, tokens } from "../styles";

function Panel({ title, items, onChange }) {
  function update(idx, key, value) {
    onChange(items.map((it, i) => i === idx ? { ...it, [key]: value } : it));
  }
  function remove(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...items, { name: "New source", pattern: "", jurisdiction: "" }]);
  }

  return (
    <div style={card}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
      <p style={{ fontSize: 11, color: tokens.textMuted, margin: "0 0 12px" }}>
        {title.includes("Primary")
          ? "Authoritative registries — values from these sources are auto-accepted on the Confirm page."
          : "Lower-trust sources — flagged for customer verification on the Confirm page."}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 80px 40px", gap: 6, padding: "6px 8px", background: tokens.navy, borderRadius: "6px 6px 0 0", color: "#fff", fontSize: 9, fontWeight: 700 }}>
        <span>NAME</span>
        <span>URL PATTERN</span>
        <span>JURIS.</span>
        <span></span>
      </div>

      {items.map((it, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "2fr 2fr 80px 40px", gap: 6,
          padding: "6px 8px", alignItems: "center",
          background: i % 2 === 0 ? "#fafcfb" : "#fff",
          borderBottom: "1px solid rgba(26,58,74,0.04)",
        }}>
          <input value={it.name || ""} onChange={(e) => update(i, "name", e.target.value)} style={{ ...inputBase, padding: "5px 8px", fontSize: 11 }} />
          <input value={it.pattern || ""} onChange={(e) => update(i, "pattern", e.target.value)} style={{ ...inputBase, padding: "5px 8px", fontSize: 11 }} />
          <input value={it.jurisdiction || ""} onChange={(e) => update(i, "jurisdiction", e.target.value)} style={{ ...inputBase, padding: "5px 8px", fontSize: 11 }} />
          <button onClick={() => remove(i)} style={{ ...btnDanger, padding: "4px 8px", fontSize: 11 }}>✕</button>
        </div>
      ))}

      <button onClick={add} style={{ ...btnPrimary, background: tokens.teal, marginTop: 8, fontSize: 12, padding: "8px 14px" }}>+ Add source</button>
    </div>
  );
}

export default function SourcesModule({ config, patchConfig, markSaved }) {
  const initial = config.sourceTiers || { primary: [], secondary: [], documentsArePrimary: true };
  const [primary, setPrimary] = useState(initial.primary || []);
  const [secondary, setSecondary] = useState(initial.secondary || []);
  const [documentsArePrimary, setDocumentsArePrimary] = useState(initial.documentsArePrimary !== false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrimary(initial.primary || []);
    setSecondary(initial.secondary || []);
    setDocumentsArePrimary(initial.documentsArePrimary !== false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.sourceTiers]);

  function handleSave() {
    patchConfig({ sourceTiers: { primary, secondary, documentsArePrimary } });
    markSaved();
    setSaved(true);
  }

  return (
    <div>
      <h2 style={sectionTitle}>Source Classification</h2>
      <p style={sectionSub}>How research sources are tiered. Primary sources auto-accept on the Confirm page; secondary sources require customer verification.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Panel title="Primary sources" items={primary} onChange={(next) => { setPrimary(next); setSaved(false); }} />
        <Panel title="Secondary sources" items={secondary} onChange={(next) => { setSecondary(next); setSaved(false); }} />
      </div>

      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600 }}>
          <input
            type="checkbox" checked={documentsArePrimary}
            onChange={(e) => { setDocumentsArePrimary(e.target.checked); setSaved(false); }}
            style={{ accentColor: tokens.brandBlue, width: 16, height: 16 }}
          />
          Documents are primary sources
        </label>
        <span style={{ fontSize: 11, color: tokens.textMuted, marginRight: "auto", marginLeft: 14 }}>
          When on, data extracted from uploaded documents is treated as authoritative.
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ color: tokens.teal, fontSize: 12, fontWeight: 600 }}>✓ Saved locally</span>}
          <button onClick={handleSave} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  );
}
