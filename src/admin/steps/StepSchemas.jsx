import React, { useEffect, useMemo, useState } from "react";
import WizardCard from "../components/WizardCard";
import SchemaFieldRow from "../components/SchemaFieldRow";
import SchemaFieldPanel from "../components/SchemaFieldPanel";
import CopyFieldModal from "../components/CopyFieldModal";
import SchemaImportButton from "../components/SchemaImportButton";
import { adminColors, adminStyles } from "../adminDesign";
import { flagFor } from "../countries";

// Step 4 — Field Schema Builder.
//
// Drives the per-(entity × licence) schema matrix. Click a cell to focus it,
// pick a starting strategy (copy / template / scratch) when empty, then edit
// research and gap fields in a two-tab table with a slide-in panel for
// add/edit.
//
// Templates for the option-card flow come from whatever the seed put in
// config.schemas for the FI / Corporate / Platform / Direct buckets — so the
// real, current canonical schemas double as starting points.

const TEMPLATE_SEEDS = ["FI", "Corporate", "Platform", "Direct"];

export default function StepSchemas({
  config,
  onChange,
  preselectedCell = null,
  isStandalone = false,
}) {
  const [selectedCell, setSelectedCell] = useState(preselectedCell);
  const [activeTab, setActiveTab] = useState("research");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  // Copy-to-other-schemas modal — opened immediately after a successful field
  // save when more than one schema is configured.
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [lastSavedField, setLastSavedField] = useState(null);
  // Cells that just received a copy — surfaced as a pulsing blue ring + label
  // on the matrix so the admin can see what got touched. Cleared after 5s.
  const [recentlyUpdated, setRecentlyUpdated] = useState(() => new Set());
  const [copyToast, setCopyToast] = useState(null);

  const entityTypes = useMemo(
    () => (config?.entityTypes || []).filter((e) => e.active),
    [config?.entityTypes]
  );
  const licences = useMemo(() => config?.licences || [], [config?.licences]);
  const schemas = config?.schemas || {};

  // Reset tab on cell change
  useEffect(() => {
    setActiveTab("research");
  }, [selectedCell]);

  const selected = useMemo(() => {
    if (!selectedCell) return null;
    const [entityId, licenceId] = selectedCell.split(":");
    const ent = entityTypes.find((e) => e.id === entityId);
    const lic = licences.find((l) => l.id === licenceId);
    return { entityId, licenceId, ent, lic };
  }, [selectedCell, entityTypes, licences]);

  const cellSchema = selected ? schemas[selectedCell] : null;
  const hasSchema = !!cellSchema && (
    (cellSchema.researchFields?.length || 0) +
    (cellSchema.gapFields?.length || 0)
  ) > 0;

  function patchSchema(updater) {
    const next = updater(cellSchema || { researchFields: [], gapFields: [] });
    onChange({ schemas: { ...schemas, [selectedCell]: next } });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }

  function copyFromCell(sourceKey) {
    const src = schemas[sourceKey];
    if (!src) return;
    patchSchema(() => ({
      researchFields: deepCopy(src.researchFields || []),
      gapFields: deepCopy(src.gapFields || []),
      configuredAt: new Date().toISOString(),
      configuredBy: "admin_copy",
    }));
  }

  function applyTemplate(entityKey) {
    // Use the first non-empty schema that matches the entity type bucket as
    // the template — defaults to a UK-based seed if present.
    const candidates = Object.keys(schemas).filter((k) => k.startsWith(entityKey + ":"));
    const firstNonEmpty = candidates.find((k) => {
      const s = schemas[k];
      return s && ((s.researchFields?.length || 0) + (s.gapFields?.length || 0)) > 0;
    });
    if (firstNonEmpty) copyFromCell(firstNonEmpty);
    else patchSchema(() => ({ researchFields: [], gapFields: [] }));
  }

  function startBlank() {
    patchSchema(() => ({ researchFields: [], gapFields: [] }));
  }

  function openAdd() {
    setEditingField(null);
    setPanelOpen(true);
  }

  function openEdit(f) {
    setEditingField(f);
    setPanelOpen(true);
  }

  function saveFieldFromPanel(updated) {
    patchSchema((curr) => {
      const list = (curr[activeTab + "Fields"] || []).slice();
      if (editingField) {
        const idx = list.findIndex((f) => f.field === editingField.field);
        if (idx >= 0) list[idx] = updated;
        else list.push(updated);
      } else {
        list.push(updated);
      }
      return { ...curr, [activeTab + "Fields"]: list };
    });
    setPanelOpen(false);
    setEditingField(null);

    // After the field is saved into the current schema, offer to copy the same
    // change to other schemas. Skipped when only one schema exists, or when
    // the field id is unusable (defensive — SchemaFieldPanel validates this
    // upstream but we don't want to crash here either way).
    const totalSchemas = Object.keys(config?.schemas || {}).length;
    if (totalSchemas <= 1) return;
    if (!updated || !updated.field) {
      // eslint-disable-next-line no-console
      console.warn("Copy modal: skipping — saved field has no id", updated);
      return;
    }
    if (!selectedCell || !(config?.schemas || {})[selectedCell]) {
      // eslint-disable-next-line no-console
      console.warn("Copy modal: skipping — sourceCell not found", selectedCell);
      return;
    }
    setLastSavedField(updated);
    setShowCopyModal(true);
  }

  function handleSchemaImport(cellKey, schema /* { researchFields, gapFields } */, mode) {
    if (!cellKey) return;
    const existing = (config?.schemas || {})[cellKey] || { researchFields: [], gapFields: [] };
    const finalSchema = mode === "merge"
      ? {
          researchFields: mergeArrays(existing.researchFields, schema.researchFields, "field"),
          gapFields: mergeArrays(existing.gapFields, schema.gapFields, "field"),
        }
      : schema;
    onChange({
      schemas: {
        ...(config?.schemas || {}),
        [cellKey]: {
          ...finalSchema,
          configuredAt: new Date().toISOString(),
          configuredBy: "excel_import",
        },
      },
    });
    const total = (finalSchema.researchFields?.length || 0) + (finalSchema.gapFields?.length || 0);
    setCopyToast(`✅ Schema imported — ${total} field${total === 1 ? "" : "s"} (${mode})`);
    setTimeout(() => setCopyToast(null), 3500);
  }

  function handleCopyApply(result) {
    const { schemaChanges, updates = [], additions = [] } = result || {};
    if (schemaChanges && Object.keys(schemaChanges).length > 0) {
      onChange({ schemas: { ...(config?.schemas || {}), ...schemaChanges } });
    }
    const touched = new Set([
      ...updates.map((u) => u.cellKey),
      ...additions.map((a) => a.cellKey),
    ]);
    if (touched.size > 0) {
      setRecentlyUpdated(touched);
      setTimeout(() => setRecentlyUpdated(new Set()), 5000);
    }
    let msg = "";
    if (updates.length) msg += `Updated ${updates.length} schema${updates.length === 1 ? "" : "s"}`;
    if (additions.length) msg += (msg ? " · " : "") + `Added to ${additions.length} schema${additions.length === 1 ? "" : "s"}`;
    if (msg) {
      setCopyToast("✅ " + msg);
      setTimeout(() => setCopyToast(null), 3500);
    }
  }

  function deleteField(f) {
    if (!window.confirm(`Delete '${f.label}'? This cannot be undone.`)) return;
    patchSchema((curr) => {
      const list = (curr[activeTab + "Fields"] || []).filter((x) => x.field !== f.field);
      return { ...curr, [activeTab + "Fields"]: list };
    });
  }

  function moveField(f, delta) {
    patchSchema((curr) => {
      const list = (curr[activeTab + "Fields"] || []).slice();
      const idx = list.findIndex((x) => x.field === f.field);
      if (idx < 0) return curr;
      const swap = idx + delta;
      if (swap < 0 || swap >= list.length) return curr;
      [list[idx], list[swap]] = [list[swap], list[idx]];
      return { ...curr, [activeTab + "Fields"]: list };
    });
  }

  function toggleAi(f) {
    patchSchema((curr) => {
      const list = (curr.researchFields || []).map((x) =>
        x.field === f.field ? { ...x, aiSearch: x.aiSearch === false ? true : false } : x
      );
      return { ...curr, researchFields: list };
    });
  }

  function moveTab(f) {
    const otherTab = activeTab === "research" ? "gap" : "research";
    patchSchema((curr) => {
      const fromList = (curr[activeTab + "Fields"] || []).filter((x) => x.field !== f.field);
      const toList = [...(curr[otherTab + "Fields"] || []), { ...f }];
      return { ...curr, [activeTab + "Fields"]: fromList, [otherTab + "Fields"]: toList };
    });
  }

  function addSection() {
    const name = window.prompt("New section name:");
    if (!name) return;
    // Sections are inferred from field.section — to "add" one, we just remember
    // it client-side and require the next field to use it. We surface it by
    // dropping a stub no-op into the panel options. Simpler: open the panel
    // pre-populated with the section name on a blank field.
    setEditingField(null);
    setPanelOpen(true);
    // We can't pre-populate the panel's internal state from here directly
    // without lifting state; the section dropdown will offer it once the
    // first field in that section saves. Hint via alert.
    alert(`Section "${name}" will appear after you save the first field with it as its section.`);
  }

  return (
    <WizardCard
      title="Field Schemas"
      subtitle="Configure the research and gap fields per entity-type × licence combination."
    >
      <SectionHeading text="Matrix" />
      <CellMatrix
        entityTypes={entityTypes}
        licences={licences}
        schemas={schemas}
        selected={selectedCell}
        onSelect={setSelectedCell}
        recentlyUpdated={recentlyUpdated}
      />

      {!selectedCell && (
        <div style={{ marginTop: 16, padding: 14, background: adminColors.wizardBg, borderRadius: 10, fontSize: 13, color: adminColors.textMuted, textAlign: "center" }}>
          Pick a cell above to configure its schema.
        </div>
      )}

      {selected && (
        <>
          <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              Configuring: {selected.ent?.label || selected.entityId}{" "}
              <span style={{ color: adminColors.textMuted, fontWeight: 500 }}>×</span>{" "}
              {flagFor(selected.lic?.jurisdictionCode)} {selected.lic?.jurisdictionName || selected.licenceId}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {savedFlash && (
                <span style={{ fontSize: 12, color: adminColors.statusComplete, fontWeight: 600 }}>✅ Saved</span>
              )}
              <SchemaImportButton
                existingSchema={hasSchema ? cellSchema : null}
                entityTypeName={selected.ent?.label || selected.entityId}
                licenceName={selected.lic?.jurisdictionName || selected.licenceId}
                onImport={(schema, mode) => handleSchemaImport(selectedCell, schema, mode)}
                variant={hasSchema ? "full" : "importOnly"}
              />
            </div>
          </div>

          {!hasSchema ? (
            <>
              <BannerImportCallout
                entityTypeName={selected.ent?.label || selected.entityId}
                licenceName={selected.lic?.jurisdictionName || selected.licenceId}
                onImport={(schema, mode) => handleSchemaImport(selectedCell, schema, mode)}
              />
              <NoSchemaOptions
                schemas={schemas}
                entityId={selected.entityId}
                onCopy={copyFromCell}
                onTemplate={applyTemplate}
                onScratch={startBlank}
              />
            </>
          ) : (
            <SchemaEditor
              schema={cellSchema}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onAdd={openAdd}
              onEdit={openEdit}
              onDelete={deleteField}
              onMove={moveField}
              onToggleAi={toggleAi}
              onMoveTab={moveTab}
              onAddSection={addSection}
            />
          )}
        </>
      )}

      <SchemaFieldPanel
        open={panelOpen}
        tab={activeTab}
        field={editingField}
        existingSections={extractSections(cellSchema)}
        existingIds={extractIds(cellSchema)}
        onClose={() => {
          setPanelOpen(false);
          setEditingField(null);
        }}
        onSave={saveFieldFromPanel}
      />

      {showCopyModal && lastSavedField && (
        <CopyFieldModal
          field={lastSavedField}
          sourceCell={selectedCell}
          allSchemas={config?.schemas || {}}
          entityTypes={config?.entityTypes || []}
          licences={config?.licences || []}
          onApply={(result) => {
            handleCopyApply(result);
          }}
          onClose={() => {
            setShowCopyModal(false);
            setLastSavedField(null);
          }}
        />
      )}

      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 400,
            background: adminColors.text,
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
          }}
        >
          {copyToast}
        </div>
      )}
    </WizardCard>
  );
}

function SectionHeading({ text }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: adminColors.textMuted, marginBottom: 10 }}>
      {text}
    </div>
  );
}

function CellMatrix({ entityTypes, licences, schemas, selected, onSelect, recentlyUpdated }) {
  const updatedSet = recentlyUpdated instanceof Set ? recentlyUpdated : new Set();
  if (!entityTypes.length || !licences.length) {
    return (
      <div style={{ padding: 14, border: `1px dashed ${adminColors.border}`, borderRadius: 10, color: adminColors.textMuted, fontSize: 13 }}>
        Add entity types and licences first.
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 4, width: "100%" }}>
        <thead>
          <tr>
            <th></th>
            {licences.map((l) => (
              <th
                key={l.id}
                style={{
                  padding: "6px 8px",
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: adminColors.text,
                }}
              >
                {flagFor(l.jurisdictionCode)} {l.jurisdictionName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entityTypes.map((e) => (
            <tr key={e.id}>
              <th
                style={{
                  padding: "6px 8px",
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: "left",
                  color: adminColors.text,
                  whiteSpace: "nowrap",
                }}
              >
                {e.icon} {e.label}
              </th>
              {licences.map((l) => {
                const associated = (e.associatedLicenceIds || []).includes(l.id);
                const key = `${e.id}:${l.id}`;
                const cfg = schemas[key];
                const has = cfg && ((cfg.researchFields?.length || 0) + (cfg.gapFields?.length || 0)) > 0;
                const isSel = selected === key;

                // Cells that aren't in the entity's associatedLicenceIds AND
                // have no configured schema are truly "not applicable" and
                // render as "—". Cells with a schema but no association are
                // orphan schemas — still surface them as ✅ with a hint so the
                // admin can find and clean up the inconsistency.
                if (!associated && !has) {
                  return (
                    <td key={l.id} style={notAssoc}>
                      —
                    </td>
                  );
                }

                const justUpdated = updatedSet.has(key);
                const isOrphan = !associated && has;
                return (
                  <td key={l.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(key)}
                      title={isOrphan ? "Schema configured but this entity is not associated with this licence. Click to review." : undefined}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: has ? adminColors.statusCompleteBg : adminColors.statusIncompleteBg,
                        color: has ? adminColors.statusComplete : adminColors.statusIncomplete,
                        border: isSel ? `2px solid ${adminColors.brandBlue}` : `1px solid transparent`,
                        fontFamily: "inherit",
                        fontWeight: 700,
                        fontSize: 14,
                        boxShadow: justUpdated ? "0 0 0 3px #93C5FD" : "none",
                        transition: "box-shadow 0.3s",
                        opacity: isOrphan ? 0.85 : 1,
                      }}
                    >
                      {has ? "✅" : "⚠"}{isOrphan ? " ⚠️" : ""}
                    </button>
                    {justUpdated && (
                      <div style={{
                        fontSize: 10,
                        color: "#2563EB",
                        fontWeight: 700,
                        textAlign: "center",
                        marginTop: 2,
                      }}>
                        ✓ Updated
                      </div>
                    )}
                    {isOrphan && !justUpdated && (
                      <div style={{
                        fontSize: 10,
                        color: "#92400E",
                        fontWeight: 700,
                        textAlign: "center",
                        marginTop: 2,
                      }}>
                        Not linked
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const notAssoc = {
  textAlign: "center",
  padding: "8px 10px",
  borderRadius: 8,
  background: "#F2F1ED",
  color: "#9C9A94",
  fontSize: 14,
};

function NoSchemaOptions({ schemas, entityId, onCopy, onTemplate, onScratch }) {
  const [copySource, setCopySource] = useState("");
  const [templateChoice, setTemplateChoice] = useState(entityId || TEMPLATE_SEEDS[0]);

  const sourceCells = Object.keys(schemas).filter((k) => {
    const s = schemas[k];
    return s && ((s.researchFields?.length || 0) + (s.gapFields?.length || 0)) > 0;
  });

  return (
    <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      <OptionCard recommended icon="📋" title="Copy from existing schema" body="Start from an already-configured schema and adjust as needed.">
        <select
          style={{ ...adminStyles.input, marginBottom: 8, fontSize: 12 }}
          value={copySource}
          onChange={(e) => setCopySource(e.target.value)}
        >
          <option value="">— Select source —</option>
          {sourceCells.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => copySource && onCopy(copySource)}
          disabled={!copySource}
          style={{ ...adminStyles.btnPrimary, width: "100%", opacity: copySource ? 1 : 0.5, cursor: copySource ? "pointer" : "not-allowed" }}
        >
          Copy and edit →
        </button>
      </OptionCard>

      <OptionCard icon="📄" title="Start from template" body="Use a pre-built template for this entity type.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {TEMPLATE_SEEDS.map((t) => {
            const on = templateChoice === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTemplateChoice(t)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  border: `1px solid ${on ? adminColors.brandBlue : adminColors.border}`,
                  background: on ? adminColors.brandBlue : "#fff",
                  color: on ? "#fff" : adminColors.text,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onTemplate(templateChoice)}
          style={{ ...adminStyles.btnPrimary, width: "100%" }}
        >
          Use template →
        </button>
      </OptionCard>

      <OptionCard icon="✏" title="Build from scratch" body="Start with an empty schema and add fields one by one.">
        <button type="button" onClick={onScratch} style={{ ...adminStyles.btnPrimary, width: "100%" }}>
          Start blank →
        </button>
      </OptionCard>
    </div>
  );
}

function OptionCard({ icon, title, body, recommended, children }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `${recommended ? 2 : 1}px solid ${recommended ? adminColors.brandBlue : adminColors.border}`,
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 18 }}>{icon}</div>
        {recommended && (
          <span style={{ fontSize: 10, fontWeight: 700, color: adminColors.brandBlue, background: "rgba(11,61,145,0.1)", padding: "2px 8px", borderRadius: 99 }}>
            RECOMMENDED
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: adminColors.text }}>{title}</div>
      <div style={{ fontSize: 12, color: adminColors.textMuted, lineHeight: 1.45, flex: 1 }}>{body}</div>
      {children}
    </div>
  );
}

function SchemaEditor({
  schema,
  activeTab,
  setActiveTab,
  onAdd,
  onEdit,
  onDelete,
  onMove,
  onToggleAi,
  onMoveTab,
  onAddSection,
}) {
  const fields = activeTab === "research" ? schema.researchFields || [] : schema.gapFields || [];
  const grouped = groupBySection(fields);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${adminColors.border}` }}>
        <TabButton on={activeTab === "research"} onClick={() => setActiveTab("research")}>
          Research Fields ({schema.researchFields?.length || 0})
        </TabButton>
        <TabButton on={activeTab === "gap"} onClick={() => setActiveTab("gap")}>
          Gap Fields ({schema.gapFields?.length || 0})
        </TabButton>
      </div>
      <p style={{ fontSize: 12, color: adminColors.textMuted, margin: "10px 0 14px" }}>
        {activeTab === "research"
          ? "Fields the AI agent will attempt to find from public sources."
          : "Fields always shown to the customer to fill manually."}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: adminColors.wizardBg, fontSize: 10, textTransform: "uppercase", color: adminColors.textMuted, textAlign: "left" }}>
            <th style={hd}>Label</th>
            <th style={hd}>Type</th>
            <th style={{ ...hd, textAlign: "center" }}>Req.</th>
            {activeTab === "research" && <th style={{ ...hd, textAlign: "center" }}>AI</th>}
            {activeTab === "research" && <th style={hd}>Hint</th>}
            <th style={{ ...hd, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ section, items }) => (
            <React.Fragment key={section}>
              <tr style={{ background: "#FAFAF7" }}>
                <td colSpan={activeTab === "research" ? 6 : 4} style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: adminColors.text }}>
                  {section}
                </td>
              </tr>
              {items.map((f) => (
                <SchemaFieldRow
                  key={f.field}
                  field={f}
                  tab={activeTab}
                  onEdit={() => onEdit(f)}
                  onDelete={() => onDelete(f)}
                  onMove={(delta) => onMove(f, delta)}
                  onToggleAi={() => onToggleAi(f)}
                  onMoveTab={() => onMoveTab(f)}
                />
              ))}
            </React.Fragment>
          ))}
          {!fields.length && (
            <tr>
              <td colSpan={activeTab === "research" ? 6 : 4} style={{ padding: 18, fontSize: 12, color: adminColors.textMuted, textAlign: "center" }}>
                No fields yet — click "+ Add Field" to get started.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" onClick={onAdd} style={adminStyles.btnPrimary}>+ Add Field</button>
        <button type="button" onClick={onAddSection} style={adminStyles.btnSecondary}>+ Add Section</button>
      </div>
    </div>
  );
}

function TabButton({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: "10px 14px",
        fontFamily: "inherit",
        fontSize: 13,
        fontWeight: 700,
        color: on ? adminColors.brandBlue : adminColors.textMuted,
        borderBottom: on ? `2px solid ${adminColors.brandBlue}` : "2px solid transparent",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

const hd = { padding: "8px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" };

function groupBySection(fields) {
  const byKey = new Map();
  for (const f of fields) {
    const key = f.section || "(no section)";
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  return Array.from(byKey.entries()).map(([section, items]) => ({ section, items }));
}

function extractSections(schema) {
  if (!schema) return [];
  const s = new Set();
  for (const f of schema.researchFields || []) if (f.section) s.add(f.section);
  for (const f of schema.gapFields || []) if (f.section) s.add(f.section);
  return Array.from(s);
}

function extractIds(schema) {
  if (!schema) return [];
  const all = [...(schema.researchFields || []), ...(schema.gapFields || [])];
  return all.map((f) => ({ id: f.field, original: f.field }));
}

function deepCopy(arr) {
  return JSON.parse(JSON.stringify(arr || []));
}

// Eye-catching banner shown above the Copy/Template/Scratch option cards on
// blank cells, so admins who already have their fields in Excel see the
// fastest path right at the top.
function BannerImportCallout({ entityTypeName, licenceName, onImport }) {
  return (
    <div style={{
      marginTop: 16,
      padding: 14,
      borderRadius: 10,
      background: "#F0F9FF",
      border: `1px solid #BAE6FD`,
      display: "flex",
      alignItems: "center",
      gap: 14,
      flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0369A1" }}>
          Already have your fields in a spreadsheet?
        </div>
        <div style={{ fontSize: 12, color: "#0369A1", marginTop: 3 }}>
          Import an Excel file with all your fields — fastest way to set this schema up.
        </div>
      </div>
      <SchemaImportButton
        existingSchema={null}
        entityTypeName={entityTypeName}
        licenceName={licenceName}
        onImport={onImport}
      />
    </div>
  );
}

// Merge two field arrays by stable id ("field"). Existing fields with the
// same id are replaced; new ids are appended. Used by Excel-import-merge.
function mergeArrays(existing, incoming, idKey = "field") {
  const out = [...(existing || [])];
  (incoming || []).forEach((f) => {
    const idx = out.findIndex((x) => x[idKey] === f[idKey]);
    if (idx >= 0) out[idx] = f;
    else out.push(f);
  });
  return out;
}
