// Excel import/export for field schemas. Pure data transforms — no UI here.
//
// External (Excel column / spec) keys vs internal (codebase) field keys.
// The rest of the codebase persists fields as:
//   { field, label, inputType, options:[{value,label}], required,
//     section, aiSearch, searchHint, showIf, showWhen }
// The Excel template uses the spec's column headers (Field ID, Field Type,
// Show Only If, etc.) for clarity to non-technical admins. This module is the
// only place the two vocabularies meet — every public function reads/writes
// the codebase shape, and uses the Excel headers strictly inside this file.

import * as XLSX from "xlsx";

export const SCHEMA_COLUMNS = [
  { key: "section",        header: "Section",                  required: true,  width: 22 },
  { key: "label",          header: "UI Label",                 required: true,  width: 28 },
  { key: "id",             header: "Field ID",                 required: true,  width: 22 },
  { key: "type",           header: "Field Type",               required: true,  width: 14 },
  { key: "required",       header: "Required",                 required: true,  width: 12 },
  { key: "tab",            header: "Research or Gap",          required: true,  width: 16 },
  { key: "options",        header: "Dropdown Values",          required: false, width: 40 },
  { key: "searchHint",     header: "AI Search Hint",           required: false, width: 40 },
  { key: "dependsOn",      header: "Show Only If (Field ID)",  required: false, width: 22 },
  { key: "dependsOnValue", header: "Show Only If (Value)",     required: false, width: 22 },
];

export const VALID_FIELD_TYPES = ["text", "textarea", "select", "date", "number", "file"];

const COLUMN_ALIASES = {
  "section": "section",
  "ui label": "label", "label": "label", "field label": "label",
  "name": "label", "field name": "label",
  "field id": "id", "id": "id", "field key": "id", "key": "id",
  "field type": "type", "type": "type", "input type": "type",
  "required": "required", "mandatory": "required", "is required": "required",
  "research or gap": "tab", "tab": "tab", "research/gap": "tab",
  "ai research": "tab", "source": "tab",
  "dropdown values": "options", "options": "options",
  "values": "options", "select options": "options",
  "ai search hint": "searchHint", "search hint": "searchHint",
  "hint": "searchHint", "search guidance": "searchHint",
  "show only if (field id)": "dependsOn", "show only if": "dependsOn",
  "depends on": "dependsOn", "conditional field": "dependsOn",
  "parent field": "dependsOn",
  "show only if (value)": "dependsOnValue", "conditional value": "dependsOnValue",
  "depends on value": "dependsOnValue", "parent value": "dependsOnValue",
};

// ──────────────────────────────────────────────────────────────────────────
// Template / export

export function buildTemplateWorkbook(existingSchema = null, entityTypeName = "", licenceName = "") {
  const wb = XLSX.utils.book_new();
  const header = SCHEMA_COLUMNS.map((c) => c.header);

  const exampleRows = [
    ["Business Entity", "Legal Entity Name", "legal_name", "text", "Yes", "Research", "",
      "Full registered legal name from Companies House or equivalent official registry", "", ""],
    ["Business Entity", "Legal Entity Type", "legal_form", "select", "Yes", "Research",
      "Private Limited Company|private_limited\nPublic Limited Company|public_limited\nLLP|llp\nPartnership|partnership\nOther|other",
      "Company type. Return the value string e.g. private_limited", "", ""],
    ["Applicant Details", "Your Full Legal Name", "applicant_full_name", "text", "Yes", "Gap", "", "", "", ""],
    ["Applicant Details", "Date of Birth", "applicant_dob", "date", "Yes", "Gap", "", "", "", ""],
    ["Regulatory Details", "Do you hold a licence?", "has_licence", "select", "Yes", "Gap",
      "Yes|Yes\nNo|No", "", "", ""],
    ["Regulatory Details", "Licence Number", "licence_number", "text", "Yes", "Gap", "", "",
      "has_licence", "Yes"],
  ];

  let dataRows = exampleRows;
  if (existingSchema) {
    const r = (existingSchema.researchFields || []).map((f) => schemaFieldToRow(f, "Research"));
    const g = (existingSchema.gapFields || []).map((f) => schemaFieldToRow(f, "Gap"));
    dataRows = [...r, ...g];
  }

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  ws["!cols"] = SCHEMA_COLUMNS.map((c) => ({ wch: c.width }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, "Fields");

  // Legend sheet
  const legendRows = [
    ["Column", "Required?", "Description", "Valid values / format"],
    ["Section", "Required", "Group name shown as a section header on the form.", "Free text"],
    ["UI Label", "Required", "Exactly what the customer sees on the form.", "Free text"],
    ["Field ID", "Required", "Unique system identifier per schema.", "lowercase letters, numbers, underscores only"],
    ["Field Type", "Required", "Input type.", VALID_FIELD_TYPES.join(", ")],
    ["Required", "Required", "Whether the customer must complete this field.", "Yes / No"],
    ["Research or Gap", "Required", "Research = AI searches publicly. Gap = always shown to customer.", "Research / Gap"],
    ["Dropdown Values", "Optional", "For Field Type = select. One option per line.", "Display Label|stored_value"],
    ["AI Search Hint", "Optional", "Tells the AI where to look and what format to return. Research fields only.", "Free text"],
    ["Show Only If (Field ID)", "Optional", "Field ID of a parent field. This field only appears when the parent has the matching value.", "Field ID of another row"],
    ["Show Only If (Value)", "Optional", "The value the parent field must equal. Must match a dropdown value exactly.", "Free text"],
  ];
  const legendWs = XLSX.utils.aoa_to_sheet(legendRows);
  legendWs["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 50 }, { wch: 44 }];
  legendWs["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, legendWs, "Legend");

  // Instructions sheet
  const instructions = [
    ["Intelligence-Led Onboarding — Field Schema Configuration"],
    [""],
    ["HOW TO USE THIS FILE"],
    [""],
    ["1. Fill in the Fields sheet with your field definitions."],
    ["   - Required columns are marked Required in the Legend sheet."],
    ["   - Each row = one field on the form."],
    ["   - Order of rows = order on the form."],
    [""],
    ["2. Field ID rules:"],
    ["   - Lowercase letters, numbers and underscores only."],
    ["   - No spaces, no special characters."],
    ["   - Must be unique within this schema."],
    ["   - Examples: legal_name, incorporation_date, has_licence"],
    [""],
    ["3. Dropdown Values format (for Field Type = select):"],
    ["   - One option per line."],
    ["   - Format: Display Label|stored_value"],
    ["   - Example:  Private Limited Company|private_limited"],
    [""],
    ["4. Conditional fields (Show Only If):"],
    ["   - Enter the Field ID of the parent field."],
    ["   - Enter the value it must equal."],
    ["   - Leave both blank for always visible."],
    [""],
    ["5. Research vs Gap:"],
    ["   - Research: AI searches for this in public sources."],
    ["   - Gap: Always shown to customer to fill in manually."],
    [""],
    ["TIPS"],
    ["- Start with the example rows as a reference."],
    ["- Delete example rows before uploading."],
    ["- Save as .xlsx format."],
    [""],
    [existingSchema ? `Schema for: ${entityTypeName} × ${licenceName}` : "Blank template"],
    [`Generated at: ${new Date().toISOString()}`],
  ];
  const instrWs = XLSX.utils.aoa_to_sheet(instructions);
  instrWs["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");

  return wb;
}

export function downloadSchemaExcel(existingSchema = null, entityTypeName = "", licenceName = "") {
  const wb = buildTemplateWorkbook(existingSchema, entityTypeName, licenceName);
  const filename = existingSchema
    ? `schema-${entityTypeName}-${licenceName}-${new Date().toISOString().slice(0, 10)}.xlsx`
        .toLowerCase()
        .replace(/[^a-z0-9-_.]/g, "-")
    : "schema-template.xlsx";
  XLSX.writeFile(wb, filename);
}

function schemaFieldToRow(field, tab) {
  return [
    field.section || "",
    field.label || "",
    field.field || "",                // internal id key is "field"
    field.inputType || "text",
    field.required ? "Yes" : "No",
    tab,
    Array.isArray(field.options) && field.options.length
      ? field.options.map((o) => `${o.label}|${o.value}`).join("\n")
      : "",
    field.searchHint || "",
    field.showIf || "",
    field.showWhen || "",
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Import / parse

export function parseSchemaExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array", cellText: true, cellDates: true });

        let sheetName = wb.SheetNames.find((n) => n === "Fields")
          || wb.SheetNames.find((n) => n.toLowerCase() === "fields")
          || wb.SheetNames[0];

        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });

        if (rows.length < 2) {
          reject(new Error("File appears to be empty. Please add at least one field row."));
          return;
        }

        const headerRow = rows[0].map((h) => String(h || "").trim());
        const columnMap = mapColumns(headerRow);
        const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell || "").trim() !== ""));
        const parsed = dataRows.map((row, idx) => parseRow(row, columnMap, idx + 2));

        resolve({
          rows: parsed,
          columnMap,
          headerRow,
          sheetName,
          totalRows: dataRows.length,
          isTemplateFormat: isTemplateFormat(headerRow),
        });
      } catch (err) {
        reject(new Error(
          "Could not read the Excel file. Please ensure it is a valid .xlsx file. Details: " + err.message
        ));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function mapColumns(headerRow) {
  const map = {};
  headerRow.forEach((header, idx) => {
    const normalised = header.toLowerCase().trim().replace(/[_-]/g, " ");
    const matched = COLUMN_ALIASES[normalised];
    if (matched && !(matched in map)) {
      map[matched] = idx;
    }
  });
  return map;
}

function isTemplateFormat(headerRow) {
  const templateHeaders = SCHEMA_COLUMNS.map((c) => c.header.toLowerCase());
  const fileHeaders = headerRow.map((h) => String(h).toLowerCase().trim());
  const matches = templateHeaders.filter((h) => fileHeaders.includes(h));
  return matches.length >= 5;
}

function parseRow(row, columnMap, rowNumber) {
  const get = (key) => {
    const idx = columnMap[key];
    if (idx === undefined) return "";
    return String(row[idx] ?? "").trim();
  };

  const typeRaw = get("type").toLowerCase();
  const type = VALID_FIELD_TYPES.includes(typeRaw) ? typeRaw : "text";

  const requiredRaw = get("required").toLowerCase();
  const required = ["yes", "true", "1", "y"].includes(requiredRaw);

  const tabRaw = get("tab").toLowerCase();
  const aiResearch = ["research", "yes", "true", "y"].includes(tabRaw);

  const optionsRaw = get("options");
  let options = [];
  if (optionsRaw && type === "select") {
    options = optionsRaw
      .split(/\n|;/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        if (parts.length >= 2) {
          return { label: parts[0].trim(), value: parts[1].trim() };
        }
        const v = line.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        return { label: line, value: v || line };
      });
  }

  const labelRaw = get("label");
  let id = get("id");
  if (!id && labelRaw) {
    // Only used when admin left Field ID blank. Mirrors slugifyId() in
    // SchemaFieldPanel: lowercase, snake_case, ASCII alnum + underscore.
    id = labelRaw.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 50);
  }

  return {
    _rowNumber: rowNumber,
    section: get("section") || "General",
    label: labelRaw,
    id,
    type,
    required,
    aiResearch,
    options,
    searchHint: get("searchHint"),
    dependsOn: get("dependsOn"),
    dependsOnValue: get("dependsOnValue"),
    _rawTab: get("tab"),
    _rawType: get("type"),
    _rawRequired: get("required"),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Validate

export function validateParsedRows(rows) {
  const errors = [];
  const warnings = [];
  // Uniqueness is per-tab. Research and gap arrays live separately on the
  // schema, and the same logical field can legitimately appear in both
  // (AI tries to find it; if it can't, the gap form collects it manually).
  const seenResearch = new Set();
  const seenGap = new Set();

  rows.forEach((row) => {
    if (!row.label) {
      errors.push({ row: row._rowNumber, field: "UI Label", message: "UI Label is required", severity: "error" });
    }
    if (!row.id) {
      errors.push({
        row: row._rowNumber,
        field: "Field ID",
        message: "Field ID is required and could not be auto-generated (no label provided)",
        severity: "error",
      });
    } else {
      // Match the admin's SchemaFieldPanel policy: letters (any case), digits
      // and underscores. The codebase has plenty of pre-existing camelCase
      // ids (applicantFirstName, addressLine1, …) so lowercasing the regex
      // would break every round-trip.
      if (!/^[a-zA-Z0-9_]+$/.test(row.id)) {
        errors.push({
          row: row._rowNumber,
          field: "Field ID",
          message: `Field ID '${row.id}' contains invalid characters. Use letters, numbers and underscores only — no spaces or punctuation.`,
          severity: "error",
        });
      }
      const seen = row.aiResearch ? seenResearch : seenGap;
      if (seen.has(row.id)) {
        errors.push({
          row: row._rowNumber,
          field: "Field ID",
          message: `Duplicate Field ID '${row.id}' in ${row.aiResearch ? "Research" : "Gap"} tab. Each ID must be unique within its tab.`,
          severity: "error",
        });
      }
      seen.add(row.id);
    }
    if (row._rawType && !VALID_FIELD_TYPES.includes(row._rawType.toLowerCase())) {
      warnings.push({
        row: row._rowNumber,
        field: "Field Type",
        message: `Unknown type '${row._rawType}' — defaulted to 'text'. Valid types: ${VALID_FIELD_TYPES.join(", ")}.`,
        severity: "warning",
      });
    }
    if (row.type === "select" && row.options.length === 0) {
      warnings.push({
        row: row._rowNumber,
        field: "Dropdown Values",
        message: `Field '${row.label}' is type 'select' but has no dropdown values. Customer will see an empty dropdown.`,
        severity: "warning",
      });
    }
    if (row.aiResearch && !row.searchHint) {
      warnings.push({
        row: row._rowNumber,
        field: "AI Search Hint",
        message: `Research field '${row.label}' has no search hint. AI accuracy may be lower without guidance.`,
        severity: "warning",
      });
    }
    if (row.dependsOn && !row.dependsOnValue) {
      warnings.push({
        row: row._rowNumber,
        field: "Show Only If (Value)",
        message: `Field '${row.label}' has a parent field but no required value — the field will always be visible.`,
        severity: "warning",
      });
    }
  });

  return { errors, warnings };
}

// ──────────────────────────────────────────────────────────────────────────
// Convert to / merge codebase schema shape

export function rowsToSchema(rows) {
  const researchFields = [];
  const gapFields = [];

  rows.forEach((row) => {
    const f = {
      field: row.id,
      label: row.label,
      section: row.section,
      inputType: row.type,
      required: !!row.required,
    };
    if (row.aiResearch) f.aiSearch = true;
    if (row.options && row.options.length) f.options = row.options;
    if (row.searchHint) f.searchHint = row.searchHint;
    if (row.dependsOn) f.showIf = row.dependsOn;
    if (row.dependsOnValue) f.showWhen = row.dependsOnValue;

    if (row.aiResearch) researchFields.push(f);
    else gapFields.push(f);
  });

  return { researchFields, gapFields };
}

export function mergeSchemas(existing, imported) {
  const mergeArray = (existingArr, importedArr) => {
    const out = [...(existingArr || [])];
    (importedArr || []).forEach((newField) => {
      const idx = out.findIndex((f) => f.field === newField.field);
      if (idx >= 0) out[idx] = newField;
      else out.push(newField);
    });
    return out;
  };
  return {
    researchFields: mergeArray(existing?.researchFields, imported.researchFields),
    gapFields: mergeArray(existing?.gapFields, imported.gapFields),
  };
}

// Used by callers to compute the replace/merge counts shown on the choice screen.
export function diffCounts(existing, imported) {
  const existingIds = new Set([
    ...(existing?.researchFields || []).map((f) => f.field),
    ...(existing?.gapFields || []).map((f) => f.field),
  ]);
  const importedFields = [
    ...(imported?.researchFields || []),
    ...(imported?.gapFields || []),
  ];
  const importedIds = new Set(importedFields.map((f) => f.field));
  const willUpdate = importedFields.filter((f) => existingIds.has(f.field)).length;
  const willAdd = importedFields.filter((f) => !existingIds.has(f.field)).length;
  const existingTotal = existingIds.size;
  const willKeepUnchanged = Array.from(existingIds).filter((id) => !importedIds.has(id)).length;
  return { willUpdate, willAdd, willKeepUnchanged, existingTotal, importedTotal: importedFields.length };
}
