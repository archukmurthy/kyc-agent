import React, { useEffect, useMemo, useState } from "react";
import WizardCard from "../components/WizardCard";
import DocumentCard from "../components/DocumentCard";
import { adminColors, adminStyles } from "../adminDesign";

// Step 5 — Document Collection.
//
// Manages config.documentLibrary (global catalog of every doc the admin can
// pick from) and config.documents[entityTypeId] (per-entity-type collection,
// which the customer flow renders on the upload step).
//
// Persisted shape stays compatible with App.js: documents[entityTypeId] is an
// array of full doc objects, not just ids. The admin still uses the library
// as a "source of truth" for doc definitions — checking a card copies the
// library entry into the entity's array; unchecking removes it.

const BLANK_DOC = () => ({
  id: "doc_" + Date.now(),
  name: "",
  helperText: "",
  icon: "📄",
  acceptedTypes: ["pdf"],
  required: false,
  aiExtraction: true,
  extractionPrompt: "",
  isWolfsberg: false,
  isWolfsbergCBDDQ: false,
  isWolfsbergFCCQ: false,
  defaultForEntityTypes: [],
});

export default function StepDocuments({
  config,
  onChange,
  isStandalone = false,
}) {
  const entityTypes = (config?.entityTypes || []).filter((e) => e.active);
  const [selectedEntityType, setSelectedEntityType] = useState(entityTypes[0]?.id || null);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [draft, setDraft] = useState(BLANK_DOC());
  const [savedFlash, setSavedFlash] = useState(false);
  const [copyFromId, setCopyFromId] = useState("");

  useEffect(() => {
    if (!selectedEntityType && entityTypes.length) {
      setSelectedEntityType(entityTypes[0].id);
    }
  }, [entityTypes, selectedEntityType]);

  const documentsForEntity = (config?.documents?.[selectedEntityType] || []);

  // The library may be missing on old configs — synthesize it from the
  // documents map so the UI has something to work with regardless.
  const effectiveLibrary = useMemo(() => {
    const lib = config?.documentLibrary || [];
    if (lib.length) return lib;
    return synthesizeLibrary(config?.documents || {});
  }, [config?.documentLibrary, config?.documents]);

  const visibleDocs = useMemo(() => {
    if (showAllDocs) return effectiveLibrary;
    return effectiveLibrary.filter((d) => (d.defaultForEntityTypes || []).includes(selectedEntityType));
  }, [effectiveLibrary, showAllDocs, selectedEntityType]);

  function flash() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function checkedForEntity(docId) {
    return documentsForEntity.some((d) => d.id === docId);
  }

  function toggleCheckedForEntity(doc, checked) {
    const docsMap = { ...(config.documents || {}) };
    const list = (docsMap[selectedEntityType] || []).slice();
    if (checked) {
      if (!list.find((d) => d.id === doc.id)) {
        list.push(libraryDocToCollectionDoc(doc, list.length + 1));
      }
    } else {
      const idx = list.findIndex((d) => d.id === doc.id);
      if (idx >= 0) list.splice(idx, 1);
    }
    docsMap[selectedEntityType] = list;
    onChange({ documents: docsMap });
    flash();
  }

  function patchLibraryDoc(docId, patch) {
    const nextLib = effectiveLibrary.map((d) => (d.id === docId ? { ...d, ...patch } : d));
    // Also patch the matching entry in every entity-type's documents list so
    // the customer flow sees the updated name/helper/etc.
    const docsMap = { ...(config.documents || {}) };
    for (const k of Object.keys(docsMap)) {
      docsMap[k] = (docsMap[k] || []).map((d) =>
        d.id === docId
          ? {
              ...d,
              name: patch.name ?? d.name,
              helperText: patch.helperText ?? d.helperText,
              icon: patch.icon ?? d.icon,
              acceptedTypes: patch.acceptedTypes ?? d.acceptedTypes,
              required: patch.required ?? d.required,
              aiExtraction: patch.aiExtraction ?? d.aiExtraction,
              extractionPrompt: patch.extractionPrompt ?? d.extractionPrompt,
            }
          : d
      );
    }
    onChange({ documentLibrary: nextLib, documents: docsMap });
    flash();
  }

  function removeFromLibrary(docId) {
    if (!window.confirm("Remove this document from the library AND from every entity type that uses it?")) return;
    const nextLib = effectiveLibrary.filter((d) => d.id !== docId);
    const docsMap = { ...(config.documents || {}) };
    for (const k of Object.keys(docsMap)) {
      docsMap[k] = (docsMap[k] || []).filter((d) => d.id !== docId);
    }
    onChange({ documentLibrary: nextLib, documents: docsMap });
    flash();
  }

  function addCustomDoc() {
    if (!draft.name.trim()) {
      alert("Document name is required.");
      return;
    }
    const newDoc = {
      ...draft,
      id: draft.id || "doc_" + Date.now(),
      defaultForEntityTypes: draft.defaultForEntityTypes || [],
    };
    const nextLib = [...effectiveLibrary, newDoc];
    const docsMap = { ...(config.documents || {}) };
    // If "suggested for current entity type" was checked, add to its list now.
    if ((newDoc.defaultForEntityTypes || []).includes(selectedEntityType)) {
      const list = (docsMap[selectedEntityType] || []).slice();
      list.push(libraryDocToCollectionDoc(newDoc, list.length + 1));
      docsMap[selectedEntityType] = list;
    }
    onChange({ documentLibrary: nextLib, documents: docsMap });
    setShowAddCustom(false);
    setDraft(BLANK_DOC());
    flash();
  }

  function copyFromEntity() {
    if (!copyFromId || copyFromId === selectedEntityType) return;
    const src = (config.documents || {})[copyFromId] || [];
    if (!window.confirm(`Replace the current ${labelFor(selectedEntityType, entityTypes)} document list with the ${labelFor(copyFromId, entityTypes)} list?`)) {
      return;
    }
    const docsMap = { ...(config.documents || {}) };
    docsMap[selectedEntityType] = src.map((d, i) => ({ ...d, sortOrder: i + 1 }));
    onChange({ documents: docsMap });
    setCopyFromId("");
    flash();
  }

  if (!entityTypes.length) {
    return (
      <WizardCard title="Document Collection" subtitle="Configure which documents you collect per entity type.">
        <div style={{ padding: 16, color: adminColors.textMuted, fontSize: 13, textAlign: "center" }}>
          Add at least one entity type in Step 3 first.
        </div>
      </WizardCard>
    );
  }

  return (
    <WizardCard
      title="Document Collection"
      subtitle="Configure which documents you collect per entity type."
    >
      {/* Entity type tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${adminColors.border}`, marginBottom: 14, flexWrap: "wrap" }}>
        {entityTypes.map((e) => {
          const on = e.id === selectedEntityType;
          const count = (config.documents?.[e.id] || []).length;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedEntityType(e.id)}
              style={{
                background: "transparent",
                border: "none",
                padding: "8px 12px",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                color: on ? adminColors.niumBlue : adminColors.textMuted,
                borderBottom: on ? `2px solid ${adminColors.niumBlue}` : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {e.icon} {e.label} ({count})
            </button>
          );
        })}
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="radio" checked={!showAllDocs} onChange={() => setShowAllDocs(false)} />
          Show suggested for {labelFor(selectedEntityType, entityTypes)}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="radio" checked={showAllDocs} onChange={() => setShowAllDocs(true)} />
          Show all documents
        </label>
        {savedFlash && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: adminColors.statusComplete, fontWeight: 600 }}>
            ✅ Saved
          </span>
        )}
      </div>

      {/* Document grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {visibleDocs.map((doc) => (
          <DocumentCard
            key={doc.id}
            doc={doc}
            checked={checkedForEntity(doc.id)}
            onToggleChecked={(c) => toggleCheckedForEntity(doc, c)}
            onPatchDoc={(p) => patchLibraryDoc(doc.id, p)}
            onRemoveFromLibrary={() => removeFromLibrary(doc.id)}
          />
        ))}
        {!visibleDocs.length && (
          <div style={{ padding: 16, color: adminColors.textMuted, fontSize: 13, textAlign: "center", gridColumn: "1 / -1" }}>
            {showAllDocs ? "Document library is empty — add a custom document below." : "No suggested documents for this entity type. Switch to 'Show all documents' or add one below."}
          </div>
        )}
      </div>

      {/* Add custom */}
      {!showAddCustom ? (
        <button
          type="button"
          onClick={() => setShowAddCustom(true)}
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
          + Add custom document
        </button>
      ) : (
        <CustomDocForm
          draft={draft}
          entityTypes={entityTypes}
          onPatch={(p) => setDraft({ ...draft, ...p })}
          onCancel={() => {
            setShowAddCustom(false);
            setDraft(BLANK_DOC());
          }}
          onAdd={addCustomDoc}
        />
      )}

      {/* Copy from another entity type */}
      <div style={{ marginTop: 24, padding: 14, border: `1px solid ${adminColors.border}`, borderRadius: 10, background: adminColors.wizardBg }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          Copy document list from another entity type
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <select
            value={copyFromId}
            onChange={(e) => setCopyFromId(e.target.value)}
            style={{ ...adminStyles.input, flex: 1 }}
          >
            <option value="">— Select entity type —</option>
            {entityTypes
              .filter((e) => e.id !== selectedEntityType)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.icon} {e.label}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={copyFromEntity}
            disabled={!copyFromId}
            style={{ ...adminStyles.btnSecondary, opacity: copyFromId ? 1 : 0.5 }}
          >
            Copy
          </button>
        </div>
      </div>
    </WizardCard>
  );
}

function CustomDocForm({ draft, entityTypes, onPatch, onCancel, onAdd }) {
  return (
    <div style={{ marginTop: 16, padding: 16, border: `1px solid ${adminColors.border}`, borderRadius: 10, background: adminColors.wizardBg }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Add custom document</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={adminStyles.label}>Document name *</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            style={adminStyles.input}
          />
        </div>
        <div>
          <label style={adminStyles.label}>Icon (emoji)</label>
          <input
            type="text"
            value={draft.icon}
            maxLength={4}
            onChange={(e) => onPatch({ icon: e.target.value })}
            style={adminStyles.input}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={adminStyles.label}>Helper text</label>
          <textarea
            value={draft.helperText}
            onChange={(e) => onPatch({ helperText: e.target.value })}
            style={{ ...adminStyles.input, minHeight: 60 }}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={adminStyles.label}>Accepted file types</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["pdf", "docx", "xlsx", "image", "any"].map((t) => {
              const on = (draft.acceptedTypes || []).includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const cur = new Set(draft.acceptedTypes || []);
                    if (cur.has(t)) cur.delete(t);
                    else cur.add(t);
                    onPatch({ acceptedTypes: Array.from(cur) });
                  }}
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
                  {t.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={adminStyles.label}>Required?</label>
          <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="radio" checked={!draft.required} onChange={() => onPatch({ required: false })} />
              Optional
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="radio" checked={!!draft.required} onChange={() => onPatch({ required: true })} />
              Required
            </label>
          </div>
        </div>
        <div>
          <label style={adminStyles.label}>AI Extraction</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={!!draft.aiExtraction} onChange={(e) => onPatch({ aiExtraction: e.target.checked })} />
            Extract fields from this document
          </label>
        </div>
        {draft.aiExtraction && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={adminStyles.label}>Extraction prompt</label>
            <textarea
              value={draft.extractionPrompt || ""}
              placeholder="Extract the following fields from this document: ..."
              onChange={(e) => onPatch({ extractionPrompt: e.target.value })}
              style={{ ...adminStyles.input, minHeight: 70, fontSize: 12 }}
            />
          </div>
        )}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={!!draft.isWolfsbergCBDDQ} onChange={(e) => onPatch({ isWolfsbergCBDDQ: e.target.checked, isWolfsberg: e.target.checked || !!draft.isWolfsbergFCCQ })} />
            Wolfsberg CBDDQ
          </label>
        </div>
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={!!draft.isWolfsbergFCCQ} onChange={(e) => onPatch({ isWolfsbergFCCQ: e.target.checked, isWolfsberg: e.target.checked || !!draft.isWolfsbergCBDDQ })} />
            Wolfsberg FCCQ
          </label>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={adminStyles.label}>Suggest this document for</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {entityTypes.map((e) => {
              const on = (draft.defaultForEntityTypes || []).includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    const cur = new Set(draft.defaultForEntityTypes || []);
                    if (cur.has(e.id)) cur.delete(e.id);
                    else cur.add(e.id);
                    onPatch({ defaultForEntityTypes: Array.from(cur) });
                  }}
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
                  {on ? "✓ " : "+ "}{e.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" onClick={onAdd} style={adminStyles.btnPrimary}>Add Document</button>
        <button type="button" onClick={onCancel} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>Cancel</button>
      </div>
    </div>
  );
}

function labelFor(entityId, entityTypes) {
  return entityTypes.find((e) => e.id === entityId)?.label || entityId;
}

function libraryDocToCollectionDoc(libDoc, sortOrder) {
  return {
    id: libDoc.id,
    name: libDoc.name,
    helperText: libDoc.helperText,
    icon: libDoc.icon,
    acceptedTypes: libDoc.acceptedTypes,
    required: !!libDoc.required,
    aiExtraction: libDoc.aiExtraction !== false,
    extractionPrompt: libDoc.extractionPrompt || "",
    isWolfsberg: !!libDoc.isWolfsberg,
    isWolfsbergCBDDQ: !!libDoc.isWolfsbergCBDDQ,
    isWolfsbergFCCQ: !!libDoc.isWolfsbergFCCQ,
    sortOrder,
    active: true,
  };
}

function synthesizeLibrary(documentsByEntity) {
  const byId = new Map();
  for (const [entityId, docs] of Object.entries(documentsByEntity)) {
    for (const d of docs || []) {
      const existing = byId.get(d.id);
      if (existing) {
        if (!existing.defaultForEntityTypes.includes(entityId)) {
          existing.defaultForEntityTypes.push(entityId);
        }
      } else {
        byId.set(d.id, {
          ...d,
          defaultForEntityTypes: [entityId],
        });
      }
    }
  }
  return Array.from(byId.values());
}
