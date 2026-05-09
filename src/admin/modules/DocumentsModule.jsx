import React, { useState, useEffect, useMemo } from "react";
import { card, label, inputBase, btnPrimary, btnDanger, btnSecondary, sectionTitle, sectionSub, tokens } from "../styles";

export default function DocumentsModule({ config, patchConfig, markSaved }) {
  const entityIds = (config.entityTypes || []).filter((e) => e.active).map((e) => e.id);
  const [activeEntity, setActiveEntity] = useState(entityIds[0] || "");
  const [allDocs, setAllDocs] = useState(config.documents || {});
  const [saved, setSaved] = useState(false);

  useEffect(() => { setAllDocs(config.documents || {}); }, [config.documents]);

  const docsForEntity = useMemo(() => allDocs[activeEntity] || [], [allDocs, activeEntity]);

  function setDocsFor(next) {
    setAllDocs((prev) => ({ ...prev, [activeEntity]: next }));
    setSaved(false);
  }

  function update(idx, key, value) {
    setDocsFor(docsForEntity.map((d, i) => i === idx ? { ...d, [key]: value } : d));
  }

  function add() {
    setDocsFor([...docsForEntity, {
      id: `doc${Date.now()}`, name: "New document", helperText: "",
      icon: "📄", acceptedTypes: ["pdf"], required: false,
      aiExtraction: false, isWolfsberg: false,
      sortOrder: docsForEntity.length + 1, active: true,
    }]);
  }

  function remove(idx) {
    if (!window.confirm("Remove this document?")) return;
    setDocsFor(docsForEntity.filter((_, i) => i !== idx));
  }

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= docsForEntity.length) return;
    const next = [...docsForEntity];
    [next[idx], next[j]] = [next[j], next[idx]];
    setDocsFor(next.map((d, i) => ({ ...d, sortOrder: i + 1 })));
  }

  function copyFrom() {
    const choices = entityIds.filter((e) => e !== activeEntity);
    const src = window.prompt(`Copy documents from another entity. Will OVERWRITE current ${activeEntity} document list.\n\nAvailable: ${choices.join(", ")}\n\nEnter source entity ID:`);
    if (!src || !allDocs[src]) return;
    setDocsFor(allDocs[src].map((d) => ({ ...d })));
  }

  function handleSave() {
    patchConfig({ documents: allDocs });
    markSaved();
    setSaved(true);
  }

  if (!entityIds.length) {
    return (
      <div>
        <h2 style={sectionTitle}>Document Collection</h2>
        <p style={sectionSub}>Add at least one active entity type before configuring documents.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={sectionTitle}>Document Collection</h2>
      <p style={sectionSub}>Documents collected per entity type during the AI + Documents journey. Each entity type has its own document list.</p>

      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "2px solid #e0e4e8" }}>
        {entityIds.map((id) => (
          <button
            key={id}
            onClick={() => setActiveEntity(id)}
            style={{
              padding: "10px 18px", border: "none", background: "transparent",
              color: activeEntity === id ? tokens.navy : tokens.textMuted,
              borderBottom: activeEntity === id ? `3px solid ${tokens.navy}` : "3px solid transparent",
              cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, marginBottom: -2,
            }}
          >{id}</button>
        ))}
      </div>

      <div style={{ marginBottom: 14, fontSize: 11, color: tokens.textMuted }}>
        {docsForEntity.length} document{docsForEntity.length === 1 ? "" : "s"} configured for <strong>{activeEntity}</strong>
      </div>

      {docsForEntity.map((d, i) => (
        <div key={i} style={card}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ flex: "0 0 60px", textAlign: "center" }}>
              <input
                value={d.icon || ""} onChange={(e) => update(i, "icon", e.target.value)}
                style={{ ...inputBase, padding: "8px", fontSize: 24, textAlign: "center" }}
              />
              <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
                <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btnPrimary, padding: "4px 8px", fontSize: 11, opacity: i === 0 ? 0.4 : 1 }}>▲</button>
                <button onClick={() => move(i, 1)} disabled={i === docsForEntity.length - 1} style={{ ...btnPrimary, padding: "4px 8px", fontSize: 11, opacity: i === docsForEntity.length - 1 ? 0.4 : 1 }}>▼</button>
              </div>
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Document ID</label>
                <input value={d.id || ""} onChange={(e) => update(i, "id", e.target.value)} style={inputBase} />
              </div>
              <div>
                <label style={label}>Display name</label>
                <input value={d.name || ""} onChange={(e) => update(i, "name", e.target.value)} style={inputBase} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label}>Helper text</label>
                <textarea
                  value={d.helperText || ""} onChange={(e) => update(i, "helperText", e.target.value)}
                  rows={2} style={{ ...inputBase, resize: "vertical" }}
                />
              </div>
              <div>
                <label style={label}>Accepted types (comma-separated)</label>
                <input
                  value={(d.acceptedTypes || []).join(", ")}
                  onChange={(e) => update(i, "acceptedTypes", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                  style={inputBase} placeholder="pdf, image"
                />
              </div>
              <div>
                <label style={label}>Sort order</label>
                <input type="number" value={d.sortOrder || 1} onChange={(e) => update(i, "sortOrder", Number(e.target.value))} style={inputBase} />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
                <Toggle label="Required" value={!!d.required} onChange={(v) => update(i, "required", v)} />
                <Toggle label="Active" value={!!d.active} onChange={(v) => update(i, "active", v)} />
                <Toggle label="AI extraction" value={!!d.aiExtraction} onChange={(v) => update(i, "aiExtraction", v)} />
                <Toggle label="Wolfsberg" value={!!d.isWolfsberg} onChange={(v) => update(i, "isWolfsberg", v)} />
              </div>
            </div>
            <button onClick={() => remove(i)} style={{ ...btnDanger, padding: "6px 10px", fontSize: 11 }}>✕</button>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={add} style={{ ...btnPrimary, background: tokens.teal }}>+ Add Document</button>
          <button onClick={copyFrom} style={btnSecondary}>Copy documents from…</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ color: tokens.teal, fontSize: 12, fontWeight: 600 }}>✓ Saved locally</span>}
          <button onClick={handleSave} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label: lbl, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: tokens.navy }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: tokens.teal }} />
      {lbl}
    </label>
  );
}
