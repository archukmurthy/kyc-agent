import React, { useEffect, useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";

const TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select (Dropdown)" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "file", label: "File Upload" },
];

function slugifyId(label) {
  return label
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

// Slide-in panel for adding/editing a single schema field. `tab` controls which
// extras show (AI search hint only for Research fields). On save, validates
// label/id/type and that the id is unique within the cell's combined fields.
export default function SchemaFieldPanel({
  open,
  tab,
  field, // existing field for edit; null for add
  existingSections,
  existingIds,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(() => ensureDefaults(field));
  const [newSection, setNewSection] = useState("");
  const [idTouched, setIdTouched] = useState(!!field);
  const [error, setError] = useState(null);
  const [optionsText, setOptionsText] = useState(() => optionsToText(field?.options || []));

  useEffect(() => {
    setForm(ensureDefaults(field));
    setOptionsText(optionsToText(field?.options || []));
    setIdTouched(!!field);
    setError(null);
    setNewSection("");
  }, [field, open]);

  function patch(p) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function handleLabelChange(v) {
    patch({ label: v });
    if (!idTouched) {
      patch({ field: slugifyId(v) });
    }
  }

  function handleSectionChange(v) {
    if (v === "__new__") {
      patch({ section: "" });
    } else {
      patch({ section: v });
    }
  }

  function handleSave() {
    setError(null);
    const trimmedLabel = (form.label || "").trim();
    const trimmedId = (form.field || "").trim();
    const effectiveSection = (form.section || newSection || "").trim();

    if (!trimmedLabel) return setError("Label is required.");
    if (!trimmedId) return setError("Field ID is required.");
    if (!form.inputType) return setError("Field type is required.");
    if (!effectiveSection) return setError("Section is required.");

    const idExists = existingIds.some(
      (e) => e.id === trimmedId && e.original !== (field?.field || null)
    );
    if (idExists) return setError(`Field ID "${trimmedId}" is already in use.`);

    const next = {
      ...form,
      label: trimmedLabel,
      field: trimmedId,
      section: effectiveSection,
    };

    if (form.inputType === "select") {
      next.options = parseOptions(optionsText);
    } else {
      delete next.options;
    }

    if (tab === "research") {
      next.aiSearch = !!form.aiSearch;
      if (next.aiSearch && form.searchHint) next.searchHint = form.searchHint.trim();
      else delete next.searchHint;
    } else {
      delete next.aiSearch;
      delete next.searchHint;
    }

    if (form.showIf && form.showWhen) {
      next.showIf = form.showIf.trim();
      next.showWhen = form.showWhen.trim();
    } else {
      delete next.showIf;
      delete next.showWhen;
    }

    onSave(next);
  }

  if (!open) return null;

  const sections = Array.from(new Set([...(existingSections || []), form.section].filter(Boolean)));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 200,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#fff",
          height: "100%",
          overflowY: "auto",
          padding: 24,
          boxShadow: "-8px 0 30px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
            {field ? "Edit Field" : "Add Field"}
          </h3>
          <button type="button" onClick={onClose} style={{ ...adminStyles.btnGhost, fontSize: 18 }}>✕</button>
        </div>

        {error && (
          <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: adminColors.danger, fontSize: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <Field label="Section">
          <select
            style={adminStyles.input}
            value={form.section && sections.includes(form.section) ? form.section : (form.section === "" ? "__new__" : form.section || "")}
            onChange={(e) => handleSectionChange(e.target.value)}
          >
            <option value="">— Select section —</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="__new__">+ New section…</option>
          </select>
          {(!form.section || !sections.includes(form.section)) && (
            <input
              type="text"
              placeholder="New section name"
              value={form.section || newSection}
              onChange={(e) => {
                setNewSection(e.target.value);
                patch({ section: e.target.value });
              }}
              style={{ ...adminStyles.input, marginTop: 8 }}
            />
          )}
        </Field>

        <Field label="UI Label" helper="Be clear and specific — this is exactly what appears on the form">
          <input
            type="text"
            value={form.label || ""}
            onChange={(e) => handleLabelChange(e.target.value)}
            style={adminStyles.input}
          />
        </Field>

        <Field label="Field ID" helper="System identifier — must be unique">
          <input
            type="text"
            value={form.field || ""}
            onChange={(e) => {
              setIdTouched(true);
              patch({ field: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") });
            }}
            style={{ ...adminStyles.input, fontFamily: "monospace", fontSize: 13 }}
          />
        </Field>

        <Field label="Field Type">
          <select
            style={adminStyles.input}
            value={form.inputType || "text"}
            onChange={(e) => patch({ inputType: e.target.value })}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        {form.inputType === "select" && (
          <Field
            label="Dropdown Values"
            helper="One value per line. Format: display_label|stored_value"
          >
            <textarea
              value={optionsText}
              placeholder={"Private Limited Company|private_limited\nPublic Limited Company|public_limited"}
              onChange={(e) => setOptionsText(e.target.value)}
              style={{ ...adminStyles.input, minHeight: 90, fontFamily: "monospace", fontSize: 12 }}
            />
            <Preview options={parseOptions(optionsText)} />
          </Field>
        )}

        <Field label={null}>
          <Toggle
            label="Required field"
            body="Customer cannot submit without completing this field"
            on={!!form.required}
            onChange={(v) => patch({ required: v })}
          />
        </Field>

        {tab === "research" && (
          <>
            <Field label={null}>
              <Toggle
                label="AI should search for this"
                body="The research agent will attempt to find this value from public sources"
                on={form.aiSearch !== false}
                onChange={(v) => patch({ aiSearch: v })}
              />
            </Field>
            {form.aiSearch !== false && (
              <Field label="Search guidance for AI" helper="Tell the AI where to look and what format to return">
                <textarea
                  value={form.searchHint || ""}
                  placeholder="e.g. Find the company registration number from Companies House or equivalent official registry"
                  onChange={(e) => patch({ searchHint: e.target.value })}
                  style={{ ...adminStyles.input, minHeight: 70 }}
                />
              </Field>
            )}
          </>
        )}

        <Field label="Show only when..." helper="Field ID that must have a specific value for this field to appear">
          <input
            type="text"
            value={form.showIf || ""}
            placeholder="e.g. has_licence"
            onChange={(e) => patch({ showIf: e.target.value })}
            style={adminStyles.input}
          />
        </Field>

        <Field label="...equals this value">
          <input
            type="text"
            value={form.showWhen || ""}
            placeholder="e.g. Yes"
            onChange={(e) => patch({ showWhen: e.target.value })}
            style={adminStyles.input}
          />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${adminColors.border}` }}>
          <button type="button" onClick={onClose} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} style={adminStyles.btnPrimary}>
            Save Field
          </button>
        </div>
      </div>
    </div>
  );
}

function ensureDefaults(field) {
  if (field) {
    return {
      field: field.field,
      label: field.label,
      inputType: field.inputType || "text",
      required: !!field.required,
      section: field.section || "",
      aiSearch: field.aiSearch !== false,
      searchHint: field.searchHint || "",
      tier: field.tier,
      showIf: field.showIf || "",
      showWhen: field.showWhen || "",
      options: field.options || [],
    };
  }
  return {
    field: "",
    label: "",
    inputType: "text",
    required: false,
    section: "",
    aiSearch: true,
    searchHint: "",
    showIf: "",
    showWhen: "",
    options: [],
  };
}

function optionsToText(opts) {
  if (!Array.isArray(opts)) return "";
  return opts
    .map((o) => (typeof o === "string" ? o : `${o.label || o}${o.value ? "|" + o.value : ""}`))
    .join("\n");
}

function parseOptions(text) {
  return (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, valuePart] = line.split("|");
      const label = (labelPart || "").trim();
      const value = (valuePart || "").trim() || label;
      return { label, value };
    });
}

function Field({ label, helper, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={adminStyles.label}>{label}</label>}
      {children}
      {helper && <div style={adminStyles.helper}>{helper}</div>}
    </div>
  );
}

function Toggle({ label, body, on, onChange }) {
  return (
    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: adminColors.text }}>{label}</div>
        {body && <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 2 }}>{body}</div>}
      </div>
    </label>
  );
}

function Preview({ options }) {
  if (!options.length) return null;
  return (
    <div style={{ marginTop: 8, padding: 10, background: adminColors.wizardBg, borderRadius: 8, border: `1px solid ${adminColors.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: adminColors.textMuted, marginBottom: 6 }}>
        Preview
      </div>
      <select style={{ ...adminStyles.input, fontSize: 12 }} disabled>
        {options.map((o, i) => (
          <option key={i}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
