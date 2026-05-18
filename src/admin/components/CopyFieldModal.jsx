import { useEffect, useMemo, useRef, useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";
import { flagFor } from "../countries";

// Three-stage modal shown after the admin saves a field in the schema editor.
//
//   Stage 1 "choose":            Pick which OTHER schemas to copy the field to.
//                                Schemas already containing the field id are
//                                rendered in Section A (update); schemas missing
//                                it are rendered in Section B (add, amber).
//   Stage 2 "confirm-additions": For each checked Section B schema, ask
//                                whether to actually add the field — one card
//                                at a time, Enter=yes, Escape=skip.
//   Stage 3 "summary":           Show what was updated / added / skipped.
//
// Field shape note — the rest of the codebase identifies fields by `field`
// (not `id`), the type is `inputType` (not `type`), and the AI flag is
// `aiSearch` (not `aiResearch`). This component uses those keys verbatim.
export default function CopyFieldModal({
  field,
  sourceCell,
  allSchemas,
  entityTypes,
  licences,
  onApply,
  onClose,
}) {
  const otherCells = useMemo(
    () => Object.keys(allSchemas || {}).filter((k) => k !== sourceCell),
    [allSchemas, sourceCell]
  );

  function fieldExistsInCell(cellKey) {
    const schema = allSchemas?.[cellKey];
    if (!schema) return false;
    const all = [
      ...(schema.researchFields || []),
      ...(schema.gapFields || []),
    ];
    return all.some((f) => f.field === field.field);
  }

  function getCellDisplayName(cellKey) {
    const [entityId, licenceId] = cellKey.split(":");
    const ent = entityTypes?.find((e) => e.id === entityId);
    const lic = licences?.find((l) => l.id === licenceId);
    const entLabel = ent?.label || entityId;
    const flag = lic ? flagFor(lic.jurisdictionCode) : "";
    const licLabel = lic?.jurisdictionName || licenceId;
    return `${entLabel} × ${flag} ${licLabel}`.trim();
  }

  const sectionA = useMemo(
    () => otherCells.filter((k) => fieldExistsInCell(k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherCells, allSchemas, field?.field]
  );
  const sectionB = useMemo(
    () => otherCells.filter((k) => !fieldExistsInCell(k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [otherCells, allSchemas, field?.field]
  );

  const [stage, setStage] = useState("choose");
  const [checkedCells, setCheckedCells] = useState(() => {
    const init = {};
    otherCells.forEach((k) => { init[k] = true; });
    return init;
  });
  const [additionConfirmations, setAdditionConfirmations] = useState({});
  const [addCursor, setAddCursor] = useState(0); // index into addQueue
  const [summaryResults, setSummaryResults] = useState({ updates: [], additions: [], skipped: [] });

  const firstCheckboxRef = useRef(null);
  useEffect(() => {
    if (stage === "choose") firstCheckboxRef.current?.focus();
  }, [stage]);

  // Escape closes the modal at the choose stage. In the confirm-additions
  // stage Escape means "skip this schema" (handled below).
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (stage === "choose" || stage === "summary") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  const checkedCount = Object.values(checkedCells).filter(Boolean).length;
  const checkedSectionB = sectionB.filter((k) => checkedCells[k]);

  function setAll(value) {
    const next = {};
    otherCells.forEach((k) => { next[k] = value; });
    setCheckedCells(next);
  }

  function applyChanges(finalConfirmations) {
    const updates = [];
    const additions = [];
    const skipped = [];
    const schemaChanges = {};

    Object.keys(checkedCells).forEach((cellKey) => {
      if (!checkedCells[cellKey]) return;
      const exists = fieldExistsInCell(cellKey);

      if (exists) {
        const schema = allSchemas[cellKey] || { researchFields: [], gapFields: [] };
        schemaChanges[cellKey] = updateFieldInSchema(schema, field);
        updates.push({ cellKey, field });
      } else {
        const conf = finalConfirmations[cellKey];
        if (conf === "yes") {
          const schema = allSchemas[cellKey] || { researchFields: [], gapFields: [] };
          schemaChanges[cellKey] = addFieldToSchema(schema, field);
          additions.push({ cellKey, field });
        } else {
          skipped.push({ cellKey, reason: "user declined" });
        }
      }
    });

    onApply({ schemaChanges, updates, additions, skipped });
    setSummaryResults({ updates, additions, skipped });
    setStage("summary");
  }

  function startStage2OrApply() {
    if (checkedSectionB.length === 0) {
      applyChanges({});
      return;
    }
    setAdditionConfirmations({});
    setAddCursor(0);
    setStage("confirm-additions");
  }

  function recordAddition(cellKey, decision) {
    const next = { ...additionConfirmations, [cellKey]: decision };
    setAdditionConfirmations(next);
    const nextCursor = addCursor + 1;
    if (nextCursor >= checkedSectionB.length) {
      applyChanges(next);
    } else {
      setAddCursor(nextCursor);
    }
  }

  // Early-out — no other schemas to copy to.
  if (otherCells.length === 0) {
    return (
      <Overlay onClickOutside={onClose}>
        <ModalShell>
          <Header
            title="No other schemas configured"
            subtitle="There are no other entity × licence schemas to copy this field to."
          />
          <FooterRight>
            <button type="button" onClick={onClose} style={adminStyles.btnPrimary}>Close</button>
          </FooterRight>
        </ModalShell>
      </Overlay>
    );
  }

  return (
    <Overlay onClickOutside={stage === "choose" ? onClose : undefined}>
      <ModalShell>
        {stage === "choose" && (
          <StageChoose
            field={field}
            sourceCell={sourceCell}
            getCellDisplayName={getCellDisplayName}
            sectionA={sectionA}
            sectionB={sectionB}
            checkedCells={checkedCells}
            setCheckedCells={setCheckedCells}
            setAll={setAll}
            checkedCount={checkedCount}
            onClose={onClose}
            onContinue={startStage2OrApply}
            firstCheckboxRef={firstCheckboxRef}
          />
        )}
        {stage === "confirm-additions" && (
          <StageConfirmAdditions
            field={field}
            cellKey={checkedSectionB[addCursor]}
            cursor={addCursor}
            total={checkedSectionB.length}
            getCellDisplayName={getCellDisplayName}
            allSchemas={allSchemas}
            onDecision={recordAddition}
          />
        )}
        {stage === "summary" && (
          <StageSummary
            results={summaryResults}
            getCellDisplayName={getCellDisplayName}
            onClose={onClose}
          />
        )}
      </ModalShell>
    </Overlay>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers — pure schema transforms

function updateFieldInSchema(schema, field) {
  const inResearch = (schema.researchFields || []).some((f) => f.field === field.field);
  if (inResearch) {
    return {
      ...schema,
      researchFields: schema.researchFields.map((f) => (f.field === field.field ? { ...field } : f)),
    };
  }
  const inGap = (schema.gapFields || []).some((f) => f.field === field.field);
  if (inGap) {
    return {
      ...schema,
      gapFields: schema.gapFields.map((f) => (f.field === field.field ? { ...field } : f)),
    };
  }
  return schema;
}

function addFieldToSchema(schema, field) {
  // aiSearch is only present (and truthy) for research-tab fields. Gap-tab
  // fields strip it on save in SchemaFieldPanel, so this cleanly routes the
  // append to the same tab the field came from.
  if (field.aiSearch) {
    return {
      ...schema,
      researchFields: [...(schema.researchFields || []), { ...field }],
    };
  }
  return {
    ...schema,
    gapFields: [...(schema.gapFields || []), { ...field }],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Stage 1 — choose

function StageChoose({
  field, sourceCell, getCellDisplayName,
  sectionA, sectionB, checkedCells, setCheckedCells,
  setAll, checkedCount, onClose, onContinue, firstCheckboxRef,
}) {
  return (
    <>
      <Header
        title="Copy field changes to other schemas?"
        subtitle={
          <>
            You updated <strong>{field.label}</strong> in <strong>{getCellDisplayName(sourceCell)}</strong>.
            Select which other schemas should receive the same change.
          </>
        }
      />

      <FieldSummary field={field} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: adminColors.textMuted }}>
          {checkedCount} of {sectionA.length + sectionB.length} schemas selected
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setAll(true)} style={{ ...adminStyles.btnGhost, fontSize: 12 }}>Select all</button>
          <button type="button" onClick={() => setAll(false)} style={{ ...adminStyles.btnGhost, fontSize: 12 }}>Deselect all</button>
        </div>
      </div>

      <div style={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${adminColors.border}`, borderRadius: 8 }}>
        {sectionA.length > 0 && (
          <SectionList
            title="Schemas that already have this field (will be updated)"
            cells={sectionA}
            checkedCells={checkedCells}
            setCheckedCells={setCheckedCells}
            getCellDisplayName={getCellDisplayName}
            tone="update"
            firstCheckboxRef={firstCheckboxRef}
          />
        )}
        {sectionB.length > 0 && (
          <SectionList
            title="Schemas that do not have this field yet (will be added if confirmed)"
            cells={sectionB}
            checkedCells={checkedCells}
            setCheckedCells={setCheckedCells}
            getCellDisplayName={getCellDisplayName}
            tone="add"
            firstCheckboxRef={sectionA.length === 0 ? firstCheckboxRef : null}
          />
        )}
      </div>

      <Footer>
        <button type="button" onClick={onClose} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
          Skip — keep change here only
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={checkedCount === 0}
          style={{
            ...adminStyles.btnPrimary,
            opacity: checkedCount === 0 ? 0.5 : 1,
            cursor: checkedCount === 0 ? "not-allowed" : "pointer",
          }}
          title={checkedCount === 0 ? "Select at least one schema to copy to, or click Skip." : ""}
        >
          Copy to Selected Schemas →
        </button>
      </Footer>
    </>
  );
}

function SectionList({ title, cells, checkedCells, setCheckedCells, getCellDisplayName, tone, firstCheckboxRef }) {
  const isAdd = tone === "add";
  return (
    <div>
      <div style={{
        padding: "8px 12px",
        background: isAdd ? "#FEF3C7" : adminColors.wizardBg,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: isAdd ? "#92400E" : adminColors.textMuted,
        borderBottom: `1px solid ${adminColors.border}`,
      }}>
        {title}
      </div>
      {cells.map((cellKey, i) => {
        const checked = !!checkedCells[cellKey];
        return (
          <label
            key={cellKey}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              cursor: "pointer",
              borderBottom: i < cells.length - 1 ? `1px solid ${adminColors.border}` : "none",
              borderLeft: isAdd ? "3px solid #FCD34D" : "3px solid transparent",
              background: isAdd ? "rgba(252,211,77,0.07)" : "#fff",
            }}
          >
            <input
              ref={i === 0 ? firstCheckboxRef : null}
              data-copy-modal-checkbox
              type="checkbox"
              checked={checked}
              onChange={(e) => setCheckedCells({ ...checkedCells, [cellKey]: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: adminColors.text }}>
                {getCellDisplayName(cellKey)}
              </div>
              <div style={{ fontSize: 11, color: isAdd ? "#92400E" : adminColors.textMuted, marginTop: 2 }}>
                {isAdd ? "⚠ Field does not exist here — you will be asked to confirm" : "Will update existing field"}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function FieldSummary({ field }) {
  const isSelect = field?.inputType === "select";
  const rows = [
    ["Field id", field?.field],
    ["Type", field?.inputType || "text"],
    ["Required", field?.required ? "Yes" : "No"],
    ["Section", field?.section || "—"],
    ["Origin", field?.aiSearch ? "Research (AI-search)" : "Gap (manual)"],
  ];
  if (isSelect) {
    rows.push(["Options", `${(field.options || []).length} values`]);
  }
  if (field?.showIf) {
    rows.push(["Visible when", `${field.showIf} = ${field.showWhen}`]);
  }
  return (
    <div style={{
      background: adminColors.wizardBg,
      border: `1px solid ${adminColors.border}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 14,
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "4px 12px",
    }}>
      {rows.map(([k, v]) => (
        <Fragment2 key={k}>
          <span style={{ fontSize: 11, color: adminColors.textMuted, fontWeight: 600 }}>{k}</span>
          <span style={{ fontSize: 12, color: adminColors.text }}>{String(v)}</span>
        </Fragment2>
      ))}
    </div>
  );
}

// Tiny fragment alias to keep the row layout readable; using React.Fragment
// directly inside a map needs a key on the fragment, which is cleaner here.
function Fragment2({ children }) {
  return <>{children}</>;
}

// ──────────────────────────────────────────────────────────────────────────
// Stage 2 — confirm additions, one cell at a time

function StageConfirmAdditions({ field, cellKey, cursor, total, getCellDisplayName, allSchemas, onDecision }) {
  const schema = allSchemas?.[cellKey] || { researchFields: [], gapFields: [] };
  const totalFields = (schema.researchFields?.length || 0) + (schema.gapFields?.length || 0);

  // Enter = add, Escape = skip. Scoped to this stage only.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); onDecision(cellKey, "yes"); }
      else if (e.key === "Escape") { e.preventDefault(); onDecision(cellKey, "no"); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cellKey, onDecision]);

  return (
    <>
      <Header
        title="Add field to this schema?"
        subtitle={
          <>
            <strong>{field.label}</strong> does not exist in <strong>{getCellDisplayName(cellKey)}</strong>. Do you want to add it?
          </>
        }
      />

      <div style={{
        background: adminColors.wizardBg,
        border: `1px solid ${adminColors.border}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, color: adminColors.textMuted, fontWeight: 600, marginBottom: 4 }}>Target schema</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{getCellDisplayName(cellKey)}</div>
        <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 4 }}>
          Currently {totalFields} field{totalFields === 1 ? "" : "s"}
          {" · "}{schema.researchFields?.length || 0} research, {schema.gapFields?.length || 0} gap
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 12 }}>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: i < cursor ? adminColors.statusComplete : (i === cursor ? adminColors.niumBlue : adminColors.border),
            }}
          />
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: adminColors.textMuted, marginBottom: 14 }}>
        Schema {cursor + 1} of {total} to review
      </div>

      <Footer>
        <button
          type="button"
          onClick={() => onDecision(cellKey, "no")}
          style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}
        >
          ✗ No — skip this schema
        </button>
        <button
          type="button"
          onClick={() => onDecision(cellKey, "yes")}
          style={adminStyles.btnPrimary}
        >
          ✓ Yes — add to this schema
        </button>
      </Footer>
      <p style={{ fontSize: 11, color: adminColors.textMuted, textAlign: "center", margin: "6px 0 0" }}>
        Press Enter to add · Escape to skip
      </p>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Stage 3 — summary

function StageSummary({ results, getCellDisplayName, onClose }) {
  const { updates, additions, skipped } = results;
  return (
    <>
      <Header title="Changes applied ✅" />

      {updates.length > 0 && (
        <SummarySection
          icon="✅"
          title={`Updated in ${updates.length} schema${updates.length === 1 ? "" : "s"}`}
          cells={updates.map((u) => u.cellKey)}
          getCellDisplayName={getCellDisplayName}
        />
      )}
      {additions.length > 0 && (
        <SummarySection
          icon="➕"
          title={`Added to ${additions.length} schema${additions.length === 1 ? "" : "s"}`}
          cells={additions.map((a) => a.cellKey)}
          getCellDisplayName={getCellDisplayName}
        />
      )}
      {skipped.length > 0 && (
        <SummarySection
          icon="⏭"
          title={`Skipped ${skipped.length} schema${skipped.length === 1 ? "" : "s"}`}
          cells={skipped.map((s) => s.cellKey)}
          getCellDisplayName={getCellDisplayName}
          muted
        />
      )}

      <div style={{ marginTop: 10, padding: 10, background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, fontSize: 12, color: "#0369A1" }}>
        These changes are saved locally. Click Publish to make them live.
      </div>

      <FooterRight>
        <button type="button" onClick={onClose} style={adminStyles.btnPrimary}>Done</button>
      </FooterRight>
    </>
  );
}

function SummarySection({ icon, title, cells, getCellDisplayName, muted = false }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: muted ? adminColors.textMuted : adminColors.text, marginBottom: 4 }}>
        {icon} {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: muted ? adminColors.textMuted : adminColors.text }}>
        {cells.map((c) => <li key={c}>{getCellDisplayName(c)}</li>)}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Layout primitives

function Overlay({ children, onClickOutside }) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && onClickOutside) onClickOutside();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

function ModalShell({ children }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 560,
        maxHeight: "85vh",
        background: "#fff",
        borderRadius: 12,
        padding: 22,
        boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}

function Header({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: adminColors.text }}>{title}</h3>
      {subtitle && (
        <p style={{ fontSize: 13, color: adminColors.textMuted, margin: "6px 0 0", lineHeight: 1.5 }}>{subtitle}</p>
      )}
    </div>
  );
}

function Footer({ children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
      {children}
    </div>
  );
}

function FooterRight({ children }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
      {children}
    </div>
  );
}
