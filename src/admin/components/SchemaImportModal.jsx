import { useEffect, useMemo, useRef, useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";
import {
  downloadSchemaExcel,
  parseSchemaExcel,
  validateParsedRows,
  rowsToSchema,
  mergeSchemas,
  diffCounts,
  VALID_FIELD_TYPES,
} from "../utils/schemaExcel";

// Four-stage modal:
//   upload  — drop/browse for the file (auto-advances on parse success)
//   preview — validation summary + field tables (research/gap tabs)
//   mode    — replace vs merge (only shown when there's an existing schema)
//   done    — success + back-to-editor button
//
// Inline editing of preview rows is intentionally not supported (admins fix
// the Excel and re-upload). Column-mapping confirmation step is also cut —
// the rule-based mapper handles template format + most common variants;
// anything unmappable surfaces as a validation error.
export default function SchemaImportModal({
  existingSchema,
  entityTypeName,
  licenceName,
  onApply,
  onClose,
}) {
  const [stage, setStage] = useState("upload");
  const [file, setFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [validation, setValidation] = useState({ errors: [], warnings: [] });
  const [importMode, setImportMode] = useState("replace");
  const [parseError, setParseError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tab, setTab] = useState("research");
  const fileInputRef = useRef(null);

  // Close on Escape at non-confirming stages.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const importedSchema = useMemo(() => {
    if (!parseResult) return { researchFields: [], gapFields: [] };
    // Mirror the admin's field-id policy: any case letters, digits, underscores.
    return rowsToSchema(
      parseResult.rows.filter((r) => r.label && r.id && /^[a-zA-Z0-9_]+$/.test(r.id))
    );
  }, [parseResult]);

  const counts = useMemo(() => diffCounts(existingSchema, importedSchema), [existingSchema, importedSchema]);

  async function handleFile(picked) {
    if (!picked) return;
    setFile(picked);
    setParseError(null);
    setIsProcessing(true);
    try {
      const result = await parseSchemaExcel(picked);
      setParseResult(result);
      setValidation(validateParsedRows(result.rows));
      setStage("preview");
    } catch (err) {
      setParseError(err.message || String(err));
    } finally {
      setIsProcessing(false);
    }
  }

  function handleContinueFromPreview() {
    if (validation.errors.length > 0) return;
    if (existingSchema && (
      (existingSchema.researchFields?.length || 0) + (existingSchema.gapFields?.length || 0) > 0
    )) {
      setStage("mode");
    } else {
      applyImport("replace");
    }
  }

  function applyImport(mode) {
    const finalSchema = mode === "merge"
      ? mergeSchemas(existingSchema, importedSchema)
      : importedSchema;
    onApply(finalSchema, mode);
  }

  return (
    <Overlay onClickOutside={onClose}>
      <Shell>
        {stage === "upload" && (
          <UploadStage
            existingSchema={existingSchema}
            entityTypeName={entityTypeName}
            licenceName={licenceName}
            file={file}
            parseError={parseError}
            isProcessing={isProcessing}
            fileInputRef={fileInputRef}
            onPickFile={handleFile}
            onDownloadTemplate={() => downloadSchemaExcel(null, entityTypeName, licenceName)}
            onCancel={onClose}
          />
        )}
        {stage === "preview" && parseResult && (
          <PreviewStage
            parseResult={parseResult}
            validation={validation}
            importedSchema={importedSchema}
            tab={tab}
            setTab={setTab}
            onBack={() => { setStage("upload"); setFile(null); setParseResult(null); }}
            onContinue={handleContinueFromPreview}
          />
        )}
        {stage === "mode" && (
          <ModeStage
            existingSchema={existingSchema}
            counts={counts}
            importMode={importMode}
            setImportMode={setImportMode}
            onBack={() => setStage("preview")}
            onApply={() => applyImport(importMode)}
          />
        )}
      </Shell>
    </Overlay>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Upload stage

function UploadStage({
  existingSchema, entityTypeName, licenceName,
  file, parseError, isProcessing, fileInputRef,
  onPickFile, onDownloadTemplate, onCancel,
}) {
  const cellLabel = entityTypeName && licenceName
    ? `${entityTypeName} × ${licenceName}`
    : "this schema";
  return (
    <>
      <Header
        title="Import Schema from Excel"
        subtitle={existingSchema
          ? `Upload an Excel file to update the ${cellLabel} schema.`
          : `Upload an Excel file to create the ${cellLabel} schema.`}
      />

      <Banner tone="info">
        Use our template for the best results. If uploading your own file, we will try to map your columns automatically (common header names are recognised).
      </Banner>

      <div style={{
        display: "flex", gap: 12, marginBottom: 14, alignItems: "stretch",
        flexWrap: "wrap",
      }}>
        <div style={{
          flex: "1 1 240px",
          padding: 14,
          border: `1px solid ${adminColors.border}`,
          borderRadius: 10,
          background: adminColors.wizardBg,
        }}>
          <div style={{ fontSize: 12, color: adminColors.textMuted, marginBottom: 6 }}>Haven't filled it in yet?</div>
          <button type="button" onClick={onDownloadTemplate} style={adminStyles.btnSecondary}>
            ⬇ Download template first
          </button>
          <div style={{ fontSize: 11, color: adminColors.textMuted, marginTop: 8, lineHeight: 1.5 }}>
            Fill it in offline, then upload it using the box below.
          </div>
        </div>
      </div>

      <UploadZone
        file={file}
        isProcessing={isProcessing}
        fileInputRef={fileInputRef}
        onPick={onPickFile}
      />

      {parseError && (
        <Banner tone="error">
          <strong>Could not read the file.</strong> {parseError}
        </Banner>
      )}

      <FooterRight>
        <button type="button" onClick={onCancel} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
          Cancel
        </button>
      </FooterRight>
    </>
  );
}

function UploadZone({ file, isProcessing, fileInputRef, onPick }) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onPick(dropped);
      }}
      onClick={() => fileInputRef.current?.click()}
      style={{
        padding: 24,
        border: `2px dashed ${dragOver ? adminColors.niumBlue : adminColors.borderStrong || adminColors.border}`,
        borderRadius: 10,
        textAlign: "center",
        cursor: "pointer",
        background: dragOver ? "rgba(11,61,145,0.04)" : "#fff",
        marginBottom: 14,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: "none" }}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
        }}
      />
      <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: adminColors.text, marginBottom: 4 }}>
        Drop your Excel file here
      </div>
      <div style={{ fontSize: 12, color: adminColors.textMuted }}>
        or click to browse · accepted: .xlsx, .xls, .csv
      </div>
      {file && (
        <div style={{
          marginTop: 12,
          fontSize: 12,
          color: adminColors.text,
          background: adminColors.wizardBg,
          padding: "6px 12px",
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}>
          {isProcessing && <Spinner />}
          <span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Preview stage

function PreviewStage({ parseResult, validation, importedSchema, tab, setTab, onBack, onContinue }) {
  const { errors, warnings } = validation;
  const research = importedSchema.researchFields || [];
  const gap = importedSchema.gapFields || [];
  const errorRows = new Set(errors.map((e) => e.row));
  const warnRows = new Set(warnings.map((w) => w.row));

  return (
    <>
      <Header
        title="Review imported fields"
        subtitle={`${parseResult.totalRows} field${parseResult.totalRows === 1 ? "" : "s"} found in your file${
          parseResult.isTemplateFormat ? "." : " — header names matched via auto-mapper."
        }`}
      />

      {errors.length > 0 && (
        <Banner tone="error">
          <strong>{errors.length} error{errors.length === 1 ? "" : "s"} found</strong> — these must be fixed before importing.
          <ValidationList items={errors} />
        </Banner>
      )}
      {errors.length === 0 && warnings.length > 0 && (
        <Banner tone="warn">
          <strong>{warnings.length} warning{warnings.length === 1 ? "" : "s"}</strong> — review before importing.
          <ValidationList items={warnings} collapsible />
        </Banner>
      )}
      {errors.length === 0 && warnings.length === 0 && (
        <Banner tone="ok">
          ✅ All {parseResult.totalRows} field{parseResult.totalRows === 1 ? "" : "s"} validated successfully.
        </Banner>
      )}

      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${adminColors.border}`, marginBottom: 8 }}>
        <TabBtn label={`Research fields (${research.length})`} on={tab === "research"} onClick={() => setTab("research")} />
        <TabBtn label={`Gap fields (${gap.length})`} on={tab === "gap"} onClick={() => setTab("gap")} />
      </div>

      <FieldTable
        rows={(tab === "research" ? research : gap)}
        parseResultRows={parseResult.rows}
        errorRows={errorRows}
        warnRows={warnRows}
      />

      <Footer>
        <button type="button" onClick={onBack} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>← Back</button>
        <button
          type="button"
          onClick={onContinue}
          disabled={errors.length > 0}
          style={{
            ...adminStyles.btnPrimary,
            opacity: errors.length > 0 ? 0.5 : 1,
            cursor: errors.length > 0 ? "not-allowed" : "pointer",
          }}
          title={errors.length > 0 ? "Fix the errors above and re-upload" : ""}
        >
          {errors.length > 0 ? "Fix errors to continue" : "Continue →"}
        </button>
      </Footer>
    </>
  );
}

function FieldTable({ rows, parseResultRows, errorRows, warnRows }) {
  if (!rows.length) {
    return (
      <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: adminColors.textMuted }}>
        No fields in this tab.
      </div>
    );
  }
  return (
    <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${adminColors.border}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: adminColors.wizardBg, position: "sticky", top: 0 }}>
            {["Section", "Label", "Field ID", "Type", "Req?", "Options"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700, borderBottom: `1px solid ${adminColors.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const raw = parseResultRows.find((r) => r.id === f.field);
            const rowNum = raw?._rowNumber;
            const isError = rowNum && errorRows.has(rowNum);
            const isWarn = rowNum && warnRows.has(rowNum);
            const bg = isError ? "#fee2e2" : isWarn ? "#fef3c7" : "transparent";
            return (
              <tr key={f.field} style={{ background: bg, borderBottom: `1px solid ${adminColors.border}` }}>
                <td style={{ padding: "6px 8px" }}>{f.section}</td>
                <td style={{ padding: "6px 8px" }}>{f.label}</td>
                <td style={{ padding: "6px 8px", fontFamily: "monospace", color: adminColors.textMuted }}>{f.field}</td>
                <td style={{ padding: "6px 8px" }}>{f.inputType}</td>
                <td style={{ padding: "6px 8px" }}>{f.required ? "Yes" : "No"}</td>
                <td style={{ padding: "6px 8px", fontSize: 11, color: adminColors.textMuted }}>
                  {f.options ? `${f.options.length} option${f.options.length === 1 ? "" : "s"}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ValidationList({ items, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div style={{ marginTop: 8 }}>
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ ...adminStyles.btnGhost, fontSize: 11, padding: "2px 8px" }}
        >
          {open ? "Hide details" : `Show details (${items.length})`}
        </button>
      )}
      {open && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
          {items.slice(0, 25).map((it, i) => (
            <li key={i}>
              Row {it.row} · <em>{it.field}</em>: {it.message}
            </li>
          ))}
          {items.length > 25 && (
            <li style={{ color: adminColors.textMuted }}>… {items.length - 25} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Mode stage

function ModeStage({ existingSchema, counts, importMode, setImportMode, onBack, onApply }) {
  const existingTotal = counts.existingTotal;
  return (
    <>
      <Header
        title="How should we apply the import?"
        subtitle={`This schema already has ${existingTotal} field${existingTotal === 1 ? "" : "s"}.`}
      />

      <ChoiceCard
        icon="🔄"
        title="Replace existing schema"
        body={`Remove all current fields and use only the imported fields. The existing ${existingTotal} field${existingTotal === 1 ? "" : "s"} will be lost.`}
        selected={importMode === "replace"}
        onSelect={() => setImportMode("replace")}
        warn={existingTotal > 0}
      />
      <ChoiceCard
        icon="➕"
        title="Merge with existing schema"
        body="Add new fields from the import. Update fields that share the same Field ID. Keep all existing fields that are not in the import."
        selected={importMode === "merge"}
        onSelect={() => setImportMode("merge")}
        detail={(
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: adminColors.textMuted }}>
            <li>Will update: {counts.willUpdate} matching field{counts.willUpdate === 1 ? "" : "s"}</li>
            <li>Will add: {counts.willAdd} new field{counts.willAdd === 1 ? "" : "s"}</li>
            <li>Will keep: {counts.willKeepUnchanged} existing field{counts.willKeepUnchanged === 1 ? "" : "s"} unchanged</li>
          </ul>
        )}
      />

      <Footer>
        <button type="button" onClick={onBack} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>← Back</button>
        <button type="button" onClick={onApply} style={adminStyles.btnPrimary}>
          Apply import →
        </button>
      </Footer>
    </>
  );
}

function ChoiceCard({ icon, title, body, selected, onSelect, warn, detail }) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: 14,
        marginBottom: 10,
        border: `2px solid ${selected ? adminColors.niumBlue : adminColors.border}`,
        borderRadius: 10,
        cursor: "pointer",
        background: selected ? "rgba(11,61,145,0.04)" : "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 22 }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: adminColors.text }}>{title}</div>
          <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 3, lineHeight: 1.5 }}>{body}</div>
          {warn && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#92400E", fontWeight: 600 }}>
              ⚠ Existing fields will be discarded.
            </div>
          )}
          {detail}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Layout primitives

function Overlay({ children, onClickOutside }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && onClickOutside) onClickOutside(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 250,
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

function Shell({ children }) {
  return (
    <div style={{
      width: "100%",
      maxWidth: 640,
      maxHeight: "88vh",
      background: "#fff",
      borderRadius: 12,
      padding: 22,
      boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
      overflowY: "auto",
    }}>
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
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 16 }}>{children}</div>;
}
function FooterRight({ children }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>{children}</div>;
}

function Banner({ tone, children }) {
  const palette = {
    info:  { bg: "#F0F9FF", border: "#BAE6FD", color: "#0369A1" },
    warn:  { bg: "#FEF3C7", border: "#FCD34D", color: "#92400E" },
    error: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
    ok:    { bg: "#ECFDF5", border: "#A7F3D0", color: "#047857" },
  };
  const p = palette[tone] || palette.info;
  return (
    <div style={{
      padding: 10,
      background: p.bg,
      border: `1px solid ${p.border}`,
      borderRadius: 8,
      fontSize: 13,
      color: p.color,
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function TabBtn({ label, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: "8px 12px",
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 700,
        color: on ? adminColors.niumBlue : adminColors.textMuted,
        borderBottom: on ? `2px solid ${adminColors.niumBlue}` : "2px solid transparent",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12, height: 12, borderRadius: "50%",
        border: "2px solid rgba(0,0,0,0.15)",
        borderTopColor: adminColors.niumBlue,
        animation: "schemaImportSpin 0.7s linear infinite",
      }}
    >
      <style>{`@keyframes schemaImportSpin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

// keep linter happy — VALID_FIELD_TYPES is re-exported in case consumers want
// the same list; not used in render path.
// eslint-disable-next-line no-unused-vars
const _unused = VALID_FIELD_TYPES;
