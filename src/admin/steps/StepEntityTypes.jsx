import React, { useEffect, useState } from "react";
import WizardCard from "../components/WizardCard";
import { adminColors, adminStyles } from "../adminDesign";
import { flagFor } from "../countries";
import { OWNERSHIP_TYPE_LIBRARY } from "../../utils/ownershipTypes";

const BLANK = () => ({
  id: "",
  label: "",
  description: "",
  icon: "🏢",
  active: true,
  sortOrder: 99,
  associatedLicenceIds: [],
  ownershipTypes: [],
});

function slugId(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32) || "entity_" + Date.now();
}

// Step 3 — entity types. Lets the admin manage the list of entity types and
// toggle which licences apply to each, which produces the schema matrix used
// in Step 4. Removing a licence association also removes its schema cell.
export default function StepEntityTypes({
  config,
  onChange,
  isStandalone = false,
  addMode = false,
}) {
  const [entityTypes, setEntityTypes] = useState(config?.entityTypes || []);
  const [showAddForm, setShowAddForm] = useState(addMode);
  const [draft, setDraft] = useState(BLANK());
  const [expandedId, setExpandedId] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    setEntityTypes(config?.entityTypes || []);
  }, [config?._version, config?.entityTypes]);

  const licences = config?.licences || [];
  const schemas = config?.schemas || {};

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  function pushEntities(next, schemaPatch) {
    setEntityTypes(next);
    onChange({
      entityTypes: next,
      ...(schemaPatch ? { schemas: schemaPatch } : {}),
    });
  }

  function updateEntity(id, patch) {
    pushEntities(entityTypes.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function deleteEntity(id) {
    const ent = entityTypes.find((e) => e.id === id);
    if (!ent) return;
    const associatedSchemas = Object.keys(schemas).filter((k) => k.startsWith(id + ":"));
    const warn = associatedSchemas.length
      ? `\n\nThis will also remove ${associatedSchemas.length} schema cell${associatedSchemas.length === 1 ? "" : "s"}.`
      : "";
    if (!window.confirm(`Delete entity type "${ent.label}"?${warn}`)) return;
    const nextSchemas = { ...schemas };
    associatedSchemas.forEach((k) => delete nextSchemas[k]);
    pushEntities(entityTypes.filter((e) => e.id !== id), nextSchemas);
    flash("Entity type deleted");
  }

  function toggleLicenceAssociation(entityId, licenceId) {
    const ent = entityTypes.find((e) => e.id === entityId);
    if (!ent) return;
    const currently = (ent.associatedLicenceIds || []).includes(licenceId);
    const key = `${entityId}:${licenceId}`;

    if (currently) {
      const hasSchema = !!schemas[key];
      if (hasSchema) {
        if (!window.confirm(`This will remove the schema for ${ent.label} × ${licenceId}. Are you sure?`)) return;
      }
      const nextEntities = entityTypes.map((e) =>
        e.id === entityId
          ? { ...e, associatedLicenceIds: (e.associatedLicenceIds || []).filter((id) => id !== licenceId) }
          : e
      );
      const nextSchemas = { ...schemas };
      delete nextSchemas[key];
      pushEntities(nextEntities, nextSchemas);
    } else {
      const nextEntities = entityTypes.map((e) =>
        e.id === entityId
          ? { ...e, associatedLicenceIds: [...(e.associatedLicenceIds || []), licenceId] }
          : e
      );
      pushEntities(nextEntities);
      flash(`Schema needed for ${ent.label} × ${licenceId} — configure it in Step 4`);
    }
  }

  function toggleOwnershipType(entityId, ownershipId) {
    const ent = entityTypes.find((e) => e.id === entityId);
    if (!ent) return;
    const current = ent.ownershipTypes || [];
    const has = current.includes(ownershipId);
    const next = has
      ? current.filter((id) => id !== ownershipId)
      : [...current, ownershipId];
    if (next.length === 0) {
      flash("At least one ownership type is required");
      return;
    }
    pushEntities(entityTypes.map((e) => (e.id === entityId ? { ...e, ownershipTypes: next } : e)));
  }

  function setAllOwnershipTypes(entityId, all) {
    const next = all
      ? OWNERSHIP_TYPE_LIBRARY.map((o) => o.id)
      : [OWNERSHIP_TYPE_LIBRARY[0].id];
    pushEntities(entityTypes.map((e) => (e.id === entityId ? { ...e, ownershipTypes: next } : e)));
    if (!all) flash("At least one ownership type is required");
  }

  function moveEntity(id, direction) {
    const idx = entityTypes.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= entityTypes.length) return;
    const arr = [...entityTypes];
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    pushEntities(arr.map((e, i) => ({ ...e, sortOrder: i + 1 })));
  }

  function addEntity() {
    if (!draft.label.trim()) {
      alert("Label is required.");
      return;
    }
    const id = draft.id || slugId(draft.label);
    if (entityTypes.find((e) => e.id === id)) {
      alert(`Entity type id "${id}" already exists — choose a different label.`);
      return;
    }
    const next = [...entityTypes, { ...draft, id, sortOrder: entityTypes.length + 1 }];
    pushEntities(next);
    setShowAddForm(false);
    setDraft(BLANK());
    const n = (draft.associatedLicenceIds || []).length;
    flash(`✅ Entity type added${n ? ` — schemas needed for ${n} licence combination${n === 1 ? "" : "s"}` : ""}`);
  }

  // Compute schema gaps for the warning panel
  const gaps = [];
  entityTypes.forEach((e) => {
    if (!e.active) return;
    (e.associatedLicenceIds || []).forEach((licId) => {
      const key = `${e.id}:${licId}`;
      const cfg = schemas[key];
      const fieldCount = (cfg?.researchFields?.length || 0) + (cfg?.gapFields?.length || 0);
      if (!fieldCount) {
        const lic = licences.find((l) => l.id === licId);
        gaps.push({ entityLabel: e.label, licenceName: lic?.jurisdictionName || licId, key });
      }
    });
  });

  return (
    <WizardCard
      title="Entity Types"
      subtitle="Define the types of entities you onboard and which licences apply to each."
    >
      {notice && (
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: adminColors.statusCompleteBg, color: adminColors.statusComplete, fontSize: 12, fontWeight: 600 }}>
          {notice}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {entityTypes.map((ent) => (
          <EntityCard
            key={ent.id}
            entity={ent}
            licences={licences}
            schemas={schemas}
            expanded={expandedId === ent.id}
            onToggle={() => setExpandedId(expandedId === ent.id ? null : ent.id)}
            onPatch={(p) => updateEntity(ent.id, p)}
            onDelete={() => deleteEntity(ent.id)}
            onToggleLicence={(licId) => toggleLicenceAssociation(ent.id, licId)}
            onToggleOwnership={(ownId) => toggleOwnershipType(ent.id, ownId)}
            onSetAllOwnership={(all) => setAllOwnershipTypes(ent.id, all)}
            onMove={(dir) => moveEntity(ent.id, dir)}
          />
        ))}
        {!entityTypes.length && (
          <div style={{ padding: 16, border: `1px dashed ${adminColors.border}`, borderRadius: 10, color: adminColors.textMuted, fontSize: 13, textAlign: "center" }}>
            No entity types yet — add one below.
          </div>
        )}
      </div>

      {!!gaps.length && (
        <div
          style={{
            marginTop: 18,
            padding: 14,
            background: adminColors.statusIncompleteBg,
            border: `1px solid ${adminColors.amber}`,
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: adminColors.statusIncomplete, marginBottom: 8 }}>
            ⚠ Schemas needed
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {gaps.map((g) => (
              <li
                key={g.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "4px 0",
                  fontSize: 12,
                  color: adminColors.text,
                }}
              >
                <span>
                  • {g.entityLabel} × {g.licenceName}
                </span>
                <span style={{ fontSize: 11, color: adminColors.textMuted }}>Configure in Step 4</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            color: adminColors.brandBlue,
          }}
        >
          + Add Entity Type
        </button>
      ) : (
        <div style={{ marginTop: 16, padding: 16, border: `1px solid ${adminColors.border}`, borderRadius: 10, background: adminColors.wizardBg }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Add an entity type</div>
          <EntityFields
            entity={draft}
            licences={licences}
            onPatch={(p) => setDraft({ ...draft, ...p })}
            onToggleLicence={(licId) => {
              const cur = new Set(draft.associatedLicenceIds || []);
              if (cur.has(licId)) cur.delete(licId);
              else cur.add(licId);
              setDraft({ ...draft, associatedLicenceIds: Array.from(cur) });
            }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="button" onClick={addEntity} style={adminStyles.btnPrimary}>
              Add Entity Type
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setDraft(BLANK());
              }}
              style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </WizardCard>
  );
}

function EntityCard({ entity, licences, schemas, expanded, onToggle, onPatch, onDelete, onToggleLicence, onToggleOwnership, onSetAllOwnership, onMove }) {
  const active = entity.active !== false;
  const assigned = entity.associatedLicenceIds || [];
  const configuredSchemas = assigned.filter(
    (licId) => (schemas[`${entity.id}:${licId}`]?.researchFields?.length || 0) > 0
  ).length;

  return (
    <div
      style={{
        border: `1px solid ${adminColors.border}`,
        borderRadius: 10,
        background: "#fff",
        overflow: "hidden",
        opacity: active ? 1 : 0.55,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "12px 14px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{entity.icon || "🏢"}</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {entity.label}{" "}
              <span style={{ color: adminColors.textMuted, fontWeight: 500 }}>({entity.id})</span>
            </span>
            <span style={{ ...adminStyles.statusBadge(active ? "complete" : "empty"), padding: "2px 8px", fontSize: 10 }}>
              {active ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>
          {entity.description && (
            <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 4 }}>{entity.description}</div>
          )}

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: adminColors.textMuted, marginBottom: 6 }}>
              Associated Licences
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {licences.length === 0 && (
                <span style={{ fontSize: 12, color: adminColors.textMuted }}>No licences configured yet.</span>
              )}
              {licences.map((lic) => {
                const on = assigned.includes(lic.id);
                return (
                  <button
                    key={lic.id}
                    type="button"
                    onClick={() => onToggleLicence(lic.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 600,
                      border: `1px solid ${on ? adminColors.brandBlue : adminColors.border}`,
                      background: on ? adminColors.brandBlue : "#fff",
                      color: on ? "#fff" : adminColors.text,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {on ? "✓ " : "+ "}
                    {flagFor(lic.jurisdictionCode)} {lic.jurisdictionName}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: adminColors.textMuted, marginBottom: 2 }}>
              Ownership Types shown to customers
            </div>
            <div style={{ fontSize: 11, color: adminColors.textMuted, marginBottom: 8 }}>
              Select which ownership types appear in the dropdown for this entity type
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => onSetAllOwnership(true)}
                style={{ ...adminStyles.btnGhost, padding: "4px 8px", fontSize: 12, color: adminColors.brandBlue, border: `1px solid ${adminColors.border}` }}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => onSetAllOwnership(false)}
                style={{ ...adminStyles.btnGhost, padding: "4px 8px", fontSize: 12, color: adminColors.textMuted, border: `1px solid ${adminColors.border}` }}
              >
                Clear All
              </button>
              <span style={{ fontSize: 11, color: adminColors.textMuted }}>
                {(entity.ownershipTypes || []).length} of {OWNERSHIP_TYPE_LIBRARY.length} enabled
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {OWNERSHIP_TYPE_LIBRARY.map((item) => {
                const on = (entity.ownershipTypes || []).includes(item.id);
                return (
                  <label
                    key={item.id}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: adminColors.text, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggleOwnership(item.id)}
                    />
                    {item.label}
                  </label>
                );
              })}
            </div>
            {(entity.ownershipTypes || []).length === 0 && (
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: adminColors.danger }}>
                At least one ownership type is required
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: adminColors.textMuted }}>
            Schemas configured: <strong>{configuredSchemas}</strong> of {assigned.length}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button
            type="button"
            onClick={onToggle}
            style={{ ...adminStyles.btnGhost, color: adminColors.brandBlue, fontWeight: 700 }}
          >
            {expanded ? "Close ▴" : "Edit ▾"}
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => onMove("up")} style={iconBtn}>↑</button>
            <button type="button" onClick={() => onMove("down")} style={iconBtn}>↓</button>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${adminColors.border}`, padding: 16, background: adminColors.wizardBg }}>
          <EntityFields entity={entity} licences={licences} onPatch={onPatch} hideLicences />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
            <button
              type="button"
              onClick={onDelete}
              style={{
                background: "transparent",
                border: "none",
                color: adminColors.danger,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              Delete entity type
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

const iconBtn = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: `1px solid ${adminColors.border}`,
  background: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
};

function EntityFields({ entity, licences, onPatch, onToggleLicence, hideLicences }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div>
        <label style={adminStyles.label}>Label</label>
        <input
          type="text"
          value={entity.label || ""}
          onChange={(e) => onPatch({ label: e.target.value })}
          style={adminStyles.input}
        />
      </div>
      <div>
        <label style={adminStyles.label}>Icon (emoji)</label>
        <input
          type="text"
          value={entity.icon || ""}
          maxLength={4}
          onChange={(e) => onPatch({ icon: e.target.value })}
          style={adminStyles.input}
        />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={adminStyles.label}>Description</label>
        <input
          type="text"
          value={entity.description || ""}
          onChange={(e) => onPatch({ description: e.target.value })}
          style={adminStyles.input}
        />
      </div>
      <div>
        <label style={adminStyles.label}>Active</label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: adminColors.text }}>
          <input
            type="checkbox"
            checked={entity.active !== false}
            onChange={(e) => onPatch({ active: e.target.checked })}
          />
          Show this entity type on the customer flow
        </label>
      </div>

      {!hideLicences && (
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={adminStyles.label}>Which licences support this entity type?</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {licences.length === 0 && (
              <span style={{ fontSize: 12, color: adminColors.textMuted }}>Add licences first in Step 2.</span>
            )}
            {licences.map((lic) => {
              const on = (entity.associatedLicenceIds || []).includes(lic.id);
              return (
                <button
                  key={lic.id}
                  type="button"
                  onClick={() => onToggleLicence(lic.id)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 600,
                    border: `1px solid ${on ? adminColors.brandBlue : adminColors.border}`,
                    background: on ? adminColors.brandBlue : "#fff",
                    color: on ? "#fff" : adminColors.text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {flagFor(lic.jurisdictionCode)} {lic.jurisdictionName}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
