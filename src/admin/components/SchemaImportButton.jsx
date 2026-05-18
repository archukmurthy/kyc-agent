import { useState } from "react";
import { adminColors } from "../adminDesign";
import { downloadSchemaExcel } from "../utils/schemaExcel";
import SchemaImportModal from "./SchemaImportModal";

// Adjacent Export/Import button group. The Export side downloads either the
// blank template (no existingSchema) or the current schema (so admins can
// edit offline and re-upload). The Import side opens the multi-stage modal.
//
// Props:
//   existingSchema     — codebase-shape schema (or null) for the active cell
//   entityTypeName     — used for the export filename
//   licenceName        — used for the export filename
//   onImport(schema, mode) — apply callback; mode is "replace" | "merge"
//   variant            — "full" (default, both buttons) | "importOnly"
//   buttonStyle        — additional CSS overrides for both buttons
export default function SchemaImportButton({
  existingSchema,
  entityTypeName = "",
  licenceName = "",
  onImport,
  variant = "full",
  buttonStyle = {},
}) {
  const [showModal, setShowModal] = useState(false);

  const baseBtn = {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    background: "#fff",
    color: adminColors.text,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    ...buttonStyle,
  };

  const handleExport = () => {
    downloadSchemaExcel(existingSchema, entityTypeName, licenceName);
  };

  return (
    <>
      <div
        style={{
          display: "inline-flex",
          border: `1px solid ${adminColors.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {variant === "full" && (
          <button
            type="button"
            onClick={handleExport}
            title={existingSchema
              ? "Download this schema as Excel for offline editing"
              : "Download blank Excel template for this schema"}
            style={{
              ...baseBtn,
              borderRight: `1px solid ${adminColors.border}`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = adminColors.wizardBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >
            ⬇ {existingSchema ? "Export schema" : "Download template"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title={existingSchema
            ? "Upload an Excel file to update this schema"
            : "Upload an Excel file to create this schema"}
          style={baseBtn}
          onMouseEnter={(e) => { e.currentTarget.style.background = adminColors.wizardBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
        >
          ⬆ Import from Excel
        </button>
      </div>

      {showModal && (
        <SchemaImportModal
          existingSchema={existingSchema}
          entityTypeName={entityTypeName}
          licenceName={licenceName}
          onApply={(schema, mode) => {
            onImport(schema, mode);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
