import React, { useState, useEffect } from "react";
import { card, inputBase, btnPrimary, btnDanger, sectionTitle, sectionSub, tokens } from "../styles";

export default function EntityTypesModule({ config, patchConfig, markSaved }) {
  const [list, setList] = useState(config.entityTypes || []);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setList(config.entityTypes || []); }, [config.entityTypes]);

  function update(idx, next) {
    setList((prev) => prev.map((e, i) => i === idx ? next : e));
    setSaved(false);
  }

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    setList((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((e, i) => ({ ...e, sortOrder: i + 1 }));
    });
    setSaved(false);
  }

  function add() {
    setList((prev) => [...prev, {
      id: `Type${prev.length + 1}`, label: "New entity type",
      description: "", icon: "🏷", active: true, sortOrder: prev.length + 1,
    }]);
    setSaved(false);
  }

  function remove(idx) {
    const ent = list[idx];
    if (!window.confirm(`Delete entity type "${ent.label}"?\n\nWarning: schemas keyed by ${ent.id}:* will also be removed.`)) return;
    setList((prev) => prev.filter((_, i) => i !== idx));
    // Cascade-delete schemas using this entity type. We don't patch yet —
    // happens on Save.
    setSaved(false);
  }

  function handleSave() {
    const sorted = [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const idsKept = new Set(sorted.map((e) => e.id));
    const filteredSchemas = Object.fromEntries(
      Object.entries(config.schemas || {}).filter(([k]) => idsKept.has(k.split(":")[0]))
    );
    patchConfig({ entityTypes: sorted, schemas: filteredSchemas });
    markSaved();
    setSaved(true);
  }

  return (
    <div>
      <h2 style={sectionTitle}>Entity Types</h2>
      <p style={sectionSub}>Customer categories shown on the first step of onboarding. Each entity type combined with each licence forms a schema (configured in Field Schemas).</p>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "60px 80px 180px 1fr 90px 120px", gap: 8, padding: "8px 10px", background: tokens.navy, borderRadius: "8px 8px 0 0", color: "#fff", fontSize: 10, fontWeight: 700 }}>
          <span>ICON</span>
          <span>ID</span>
          <span>LABEL</span>
          <span>DESCRIPTION</span>
          <span>ACTIVE</span>
          <span>ORDER</span>
        </div>

        {list.map((e, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "60px 80px 180px 1fr 90px 120px", gap: 8,
            padding: "10px", alignItems: "center",
            background: i % 2 === 0 ? "#fafcfb" : "#fff",
            borderBottom: "1px solid rgba(26,58,74,0.04)",
          }}>
            <input value={e.icon || ""} onChange={(ev) => update(i, { ...e, icon: ev.target.value })} style={{ ...inputBase, padding: "6px 8px", fontSize: 16, textAlign: "center" }} />
            <input value={e.id || ""} onChange={(ev) => update(i, { ...e, id: ev.target.value })} style={{ ...inputBase, padding: "6px 8px", fontSize: 12 }} />
            <input value={e.label || ""} onChange={(ev) => update(i, { ...e, label: ev.target.value })} style={{ ...inputBase, padding: "6px 8px", fontSize: 12 }} />
            <input value={e.description || ""} onChange={(ev) => update(i, { ...e, description: ev.target.value })} style={{ ...inputBase, padding: "6px 8px", fontSize: 12 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600 }}>
              <input type="checkbox" checked={!!e.active} onChange={(ev) => update(i, { ...e, active: ev.target.checked })} style={{ accentColor: tokens.teal }} />
              {e.active ? "Active" : "Hidden"}
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btnPrimary, padding: "4px 10px", fontSize: 11, opacity: i === 0 ? 0.4 : 1 }}>▲</button>
              <button onClick={() => move(i, 1)} disabled={i === list.length - 1} style={{ ...btnPrimary, padding: "4px 10px", fontSize: 11, opacity: i === list.length - 1 ? 0.4 : 1 }}>▼</button>
              <button onClick={() => remove(i)} style={{ ...btnDanger, padding: "4px 8px", fontSize: 11 }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <button onClick={add} style={{ ...btnPrimary, background: tokens.teal }}>+ Add Entity Type</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ color: tokens.teal, fontSize: 12, fontWeight: 600 }}>✓ Saved locally</span>}
          <button onClick={handleSave} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  );
}
