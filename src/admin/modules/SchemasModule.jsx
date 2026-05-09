import React, { useState, useEffect, useMemo } from "react";
import { card, label, inputBase, btnPrimary, btnSecondary, sectionTitle, sectionSub, tokens } from "../styles";

const TABS = [
  { id: "research", label: "Research Fields", description: "Fields the AI tries to find via web research and documents" },
  { id: "gap", label: "Gap Fields", description: "Fields the customer fills in manually after research" },
];

function emptyField(tab) {
  if (tab === "research") return { field: "newField", label: "New field", tier: 1, searchHint: "" };
  return { field: "newField", label: "New field", inputType: "text", required: false, section: "applicant" };
}

function FieldEditor({ field, onSave, onCancel, tab }) {
  const [f, setF] = useState(field);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 420,
      background: "#fff", boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
      padding: "24px 28px", overflowY: "auto", zIndex: 100,
    }}>
      <h3 style={{ marginTop: 0, fontSize: 16 }}>Edit field</h3>

      <div style={{ marginBottom: 12 }}>
        <label style={label}>Field ID *</label>
        <input value={f.field || ""} onChange={(e) => set("field", e.target.value)} style={inputBase} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={label}>Label *</label>
        <input value={f.label || ""} onChange={(e) => set("label", e.target.value)} style={inputBase} />
      </div>

      {tab === "research" ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Tier</label>
            <select value={f.tier || 1} onChange={(e) => set("tier", Number(e.target.value))} style={inputBase}>
              <option value={1}>Tier 1 — basic identity / public registry</option>
              <option value={2}>Tier 2 — enrichment / risk screening</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Search hint (instructs AI where to look)</label>
            <textarea value={f.searchHint || ""} onChange={(e) => set("searchHint", e.target.value)} rows={3} style={{ ...inputBase, resize: "vertical" }} />
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Section</label>
            <input value={f.section || ""} onChange={(e) => set("section", e.target.value)} style={inputBase} placeholder="applicant, nature, account..." />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Input type</label>
            <select value={f.inputType || "text"} onChange={(e) => set("inputType", e.target.value)} style={inputBase}>
              {["text", "email", "tel", "date", "select", "textarea", "file"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => set("required", e.target.checked)} style={{ marginRight: 6 }} />
              Required
            </label>
          </div>
          {f.inputType === "select" && (
            <div style={{ marginBottom: 12 }}>
              <label style={label}>Options (one per line)</label>
              <textarea
                value={(f.options || []).join("\n")}
                onChange={(e) => set("options", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
                rows={5} style={{ ...inputBase, resize: "vertical" }}
              />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Placeholder</label>
            <input value={f.placeholder || ""} onChange={(e) => set("placeholder", e.target.value)} style={inputBase} />
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
        <button style={btnPrimary} onClick={() => onSave(f)}>Save field</button>
      </div>
    </div>
  );
}

export default function SchemasModule({ config, patchConfig, markSaved }) {
  const entityIds = (config.entityTypes || []).filter((e) => e.active).map((e) => e.id);
  const licenceIds = (config.licences || []).map((l) => l.id);
  const [entity, setEntity] = useState(entityIds[0] || "");
  const [licence, setLicence] = useState(licenceIds[0] || "");
  const [tab, setTab] = useState("research");
  const [editing, setEditing] = useState(null); // { idx, field } | { idx: null, field } for new
  const [saved, setSaved] = useState(false);

  const key = entity && licence ? `${entity}:${licence}` : "";
  const schema = useMemo(() => config.schemas?.[key] || { researchFields: [], gapFields: [] }, [config.schemas, key]);
  const [working, setWorking] = useState(schema);

  useEffect(() => { setWorking(schema); setSaved(false); }, [schema]);

  function fields() { return tab === "research" ? working.researchFields || [] : working.gapFields || []; }
  function setFields(next) {
    setWorking((prev) => tab === "research" ? { ...prev, researchFields: next } : { ...prev, gapFields: next });
    setSaved(false);
  }

  function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= fields().length) return;
    const next = [...fields()];
    [next[idx], next[j]] = [next[j], next[idx]];
    setFields(next);
  }
  function remove(idx) {
    if (!window.confirm("Delete this field?")) return;
    setFields(fields().filter((_, i) => i !== idx));
  }
  function saveEdit(f) {
    if (editing.idx == null) {
      setFields([...fields(), f]);
    } else {
      setFields(fields().map((x, i) => i === editing.idx ? f : x));
    }
    setEditing(null);
  }

  function copyFrom() {
    const choices = Object.keys(config.schemas || {}).filter((k) => k !== key);
    const src = window.prompt(`Copy schema from another combination. This will OVERWRITE the current ${key} schema.\n\nAvailable: ${choices.join(", ")}\n\nEnter source key (e.g. Corporate:GB):`);
    if (!src || !config.schemas[src]) return;
    setWorking({
      researchFields: [...config.schemas[src].researchFields],
      gapFields: [...config.schemas[src].gapFields],
    });
    setSaved(false);
  }

  function handleSave() {
    if (!key) return;
    patchConfig({ schemas: { ...(config.schemas || {}), [key]: working } });
    markSaved();
    setSaved(true);
  }

  const sectionGroups = useMemo(() => {
    if (tab !== "gap") return null;
    const groups = {};
    const list = working.gapFields || [];
    list.forEach((f, i) => {
      const s = f.section || "(no section)";
      if (!groups[s]) groups[s] = [];
      groups[s].push({ field: f, idx: i });
    });
    return groups;
  }, [working, tab]);

  if (!entityIds.length || !licenceIds.length) {
    return (
      <div>
        <h2 style={sectionTitle}>Field Schemas</h2>
        <p style={sectionSub}>Add at least one active entity type and one licence before configuring schemas.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={sectionTitle}>Field Schemas</h2>
      <p style={sectionSub}>Pick an entity type + licence to edit the schema for that combination. Research fields drive the AI's web search; gap fields are filled by the customer.</p>

      <div style={card}>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Entity type</label>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} style={inputBase}>
              {entityIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Licence</label>
            <select value={licence} onChange={(e) => setLicence(e.target.value)} style={inputBase}>
              {licenceIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <button onClick={copyFrom} style={btnSecondary}>Copy from…</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: tokens.textMuted }}>
          Editing schema: <strong>{key}</strong> · {(working.researchFields || []).length} research fields · {(working.gapFields || []).length} gap fields
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, borderBottom: "2px solid #e0e4e8" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 18px", border: "none", background: "transparent",
              color: tab === t.id ? tokens.navy : tokens.textMuted,
              borderBottom: tab === t.id ? `3px solid ${tokens.navy}` : "3px solid transparent",
              cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
              marginBottom: -2,
            }}
          >{t.label}</button>
        ))}
      </div>
      <p style={{ ...sectionSub, marginTop: 0 }}>{TABS.find((t) => t.id === tab).description}</p>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 100px 130px", gap: 8, padding: "8px 10px", background: tokens.navy, borderRadius: "8px 8px 0 0", color: "#fff", fontSize: 10, fontWeight: 700 }}>
          <span>FIELD</span>
          <span>LABEL</span>
          <span>{tab === "research" ? "TIER" : "TYPE"}</span>
          <span>{tab === "research" ? "SEARCH HINT" : "REQUIRED"}</span>
          <span>ACTIONS</span>
        </div>

        {tab === "gap" && sectionGroups
          ? Object.entries(sectionGroups).map(([sec, items]) => (
              <div key={sec}>
                <div style={{ padding: "8px 10px", background: "#eef3f7", fontSize: 11, fontWeight: 700, color: tokens.navy, borderBottom: "1px solid rgba(26,58,74,0.06)" }}>
                  Section: {sec}
                </div>
                {items.map(({ field: f, idx }, n) => (
                  <FieldRow key={f.field + idx} f={f} idx={idx} tab={tab} n={n}
                    onMove={move} onRemove={remove} onEdit={(i) => setEditing({ idx: i, field: f })} />
                ))}
              </div>
            ))
          : fields().map((f, i) => (
              <FieldRow key={f.field + i} f={f} idx={i} tab={tab} n={i}
                onMove={move} onRemove={remove} onEdit={(idx) => setEditing({ idx, field: f })} />
            ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setEditing({ idx: null, field: emptyField(tab) })} style={{ ...btnPrimary, background: tokens.teal }}>
            + Add Field
          </button>
          {tab === "gap" && (
            <button
              onClick={() => {
                const name = window.prompt("Section name (e.g. applicant, nature, account):");
                if (!name) return;
                setFields([...fields(), { field: `newField_${Date.now()}`, label: "New field", inputType: "text", required: false, section: name }]);
              }}
              style={btnSecondary}
            >+ Add Section</button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ color: tokens.teal, fontSize: 12, fontWeight: 600 }}>✓ Saved locally</span>}
          <button onClick={handleSave} style={btnPrimary}>Save schema</button>
        </div>
      </div>

      {editing && <FieldEditor field={editing.field} tab={tab} onSave={saveEdit} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function FieldRow({ f, idx, tab, n, onMove, onRemove, onEdit }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr 100px 100px 130px", gap: 8,
      padding: "9px 10px", alignItems: "center",
      background: n % 2 === 0 ? "#fafcfb" : "#fff",
      borderBottom: "1px solid rgba(26,58,74,0.04)",
      fontSize: 11,
    }}>
      <span style={{ fontFamily: "Menlo, monospace", color: "#555", wordBreak: "break-all" }}>{f.field}</span>
      <span style={{ fontWeight: 600 }}>{f.label}</span>
      <span>{tab === "research" ? `Tier ${f.tier || 1}` : f.inputType || "text"}</span>
      <span style={{ color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tab === "research"
          ? (f.searchHint ? "✓" : "—")
          : (f.required ? "Yes" : "No")}
      </span>
      <span style={{ display: "flex", gap: 4 }}>
        <button onClick={() => onMove(idx, -1)} style={btnIcon}>▲</button>
        <button onClick={() => onMove(idx, 1)} style={btnIcon}>▼</button>
        <button onClick={() => onEdit(idx)} style={btnIcon}>✎</button>
        <button onClick={() => onRemove(idx)} style={{ ...btnIcon, color: "#dc2626" }}>✕</button>
      </span>
    </div>
  );
}

const btnIcon = {
  background: "transparent",
  border: "1px solid rgba(26,58,74,0.2)",
  borderRadius: 4,
  padding: "3px 7px",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
};
