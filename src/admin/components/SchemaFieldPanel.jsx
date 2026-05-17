import React, { useEffect, useMemo, useRef, useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";

const TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select (Dropdown)" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "file", label: "File Upload" },
];

const HINT_MAX = 200;

function slugifyId(label) {
  return label
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

// Slide-in panel for adding/editing a single schema field.
//
// Layout uses a flex column with a fixed footer so the Save / Cancel buttons
// are never hidden behind the scrolling form, regardless of viewport height
// or number of fields. The scrollable body and the footer are siblings of a
// flex container with overflow:hidden, which is the only reliable way to
// pin a footer in a fixed-height panel.
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
  const [saving, setSaving] = useState(false);
  const optionsRef = useRef(null);
  const initialSnapshot = useRef(snapshot(field, optionsToText(field?.options || [])));

  useEffect(() => {
    setForm(ensureDefaults(field));
    setOptionsText(optionsToText(field?.options || []));
    setIdTouched(!!field);
    setError(null);
    setNewSection("");
    setSaving(false);
    initialSnapshot.current = snapshot(field, optionsToText(field?.options || []));
  }, [field, open]);

  // Auto-focus the dropdown values textarea when the admin switches type to select
  // so they immediately see where to type the values.
  useEffect(() => {
    if (open && form.inputType === "select" && optionsRef.current) {
      const t = setTimeout(() => {
        try { optionsRef.current.focus(); } catch (_) {}
      }, 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, form.inputType]);

  const isDirty = useMemo(
    () => open && !sameSnapshot(initialSnapshot.current, snapshot({ ...form }, optionsText)),
    [open, form, optionsText],
  );

  function attemptClose() {
    if (isDirty) {
      const ok = window.confirm("Discard unsaved changes to this field?");
      if (!ok) return;
    }
    onClose();
  }

  // ESC closes the panel (with the unsaved-changes guard).
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        attemptClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isDirty]);

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

  function handleHintChange(v) {
    const clipped = v.length > HINT_MAX ? v.slice(0, HINT_MAX) : v;
    patch({ searchHint: clipped });
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

    setSaving(true);
    // Synchronously hand the field up. The parent closes the panel on its own
    // tick, but we keep the button disabled until then so a rapid double-click
    // can't fire two saves.
    try {
      onSave(next);
    } finally {
      setTimeout(() => setSaving(false), 250);
    }
  }

  if (!open) return null;

  const sections = Array.from(new Set([...(existingSections || []), form.section].filter(Boolean)));
  const hintLen = (form.searchHint || "").length;

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
      onClick={attemptClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#fff",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.2)",
        }}
      >
        {/* Fixed header */}
        <div style={{ flexShrink: 0, padding: "20px 24px 14px", borderBottom: `1px solid ${adminColors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
              {field ? "Edit Field" : "Add Field"}
            </h3>
            {isDirty && (
              <span
                title="You have unsaved changes in this panel"
                style={{ fontSize: 11, fontWeight: 700, color: adminColors.statusIncomplete, display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: adminColors.amber || "#e0a040" }} />
                Unsaved
              </span>
            )}
          </div>
          <button type="button" onClick={attemptClose} style={{ ...adminStyles.btnGhost, fontSize: 18 }} aria-label="Close panel">
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
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
                ref={optionsRef}
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
                    onChange={(e) => handleHintChange(e.target.value)}
                    maxLength={HINT_MAX}
                    style={{ ...adminStyles.input, minHeight: 70 }}
                  />
                  <div style={{ marginTop: 4, fontSize: 11, color: hintLen >= HINT_MAX ? adminColors.danger : adminColors.textMuted, textAlign: "right" }}>
                    {hintLen}/{HINT_MAX} characters
                  </div>
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
        </div>

        {/* Fixed footer — Save is always reachable */}
        <div
          style={{
            flexShrink: 0,
            padding: "14px 24px",
            borderTop: `1px solid ${adminColors.border}`,
            background: "#fff",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={attemptClose}
            style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              ...adminStyles.btnPrimary,
              opacity: saving ? 0.7 : 1,
              cursor: saving ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
            disabled={saving}
          >
            {saving && (
              <span
                style={{
                  width: 12, height: 12, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "#fff",
                  display: "inline-block",
                  animation: "schemaFieldPanelSpin 0.7s linear infinite",
                }}
              />
            )}
            {saving ? "Saving…" : "Save Field"}
          </button>
          <style>{`@keyframes schemaFieldPanelSpin { to { transform: rotate(360deg); } }`}</style>
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

function snapshot(f, optsText) {
  const base = f || {};
  return JSON.stringify({
    field: base.field || "",
    label: base.label || "",
    inputType: base.inputType || "text",
    required: !!base.required,
    section: base.section || "",
    aiSearch: base.aiSearch !== false,
    searchHint: base.searchHint || "",
    showIf: base.showIf || "",
    showWhen: base.showWhen || "",
    optionsText: optsText || "",
  });
}

function sameSnapshot(a, b) {
  return a === b;
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
