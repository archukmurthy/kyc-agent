import { useEffect, useRef, useState } from "react";

// Lightweight type-to-filter dropdown. No external deps. Used on the customer
// flow's Step 1 (entity type + country) and the admin Licences step.
//
// Single-select API:
//   options: [{ value, label, description? }]
//   value:   currently selected value (string)
//   onChange: called with the new value (string)
//
// Multi-select API (multiple=true):
//   value:    array of selected values
//   onChange: called with the next array
//   Selected values render as removable chips beneath the input.
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  id,
  multiple = false,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedValues = multiple
    ? (Array.isArray(value) ? value : [])
    : [];
  const selectedOption = multiple
    ? null
    : options.find((o) => o.value === value);

  const filtered = options.filter((opt) => {
    if (multiple && selectedValues.includes(opt.value)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      opt.label.toLowerCase().includes(q)
      || (opt.description || "").toLowerCase().includes(q)
      || String(opt.value).toLowerCase().includes(q)
    );
  });

  const selectSingle = (optValue) => {
    onChange(optValue);
    setOpen(false);
    setQuery("");
  };
  const toggleMulti = (optValue) => {
    const next = selectedValues.includes(optValue)
      ? selectedValues.filter((v) => v !== optValue)
      : [...selectedValues, optValue];
    onChange(next);
    setQuery("");
    // Keep open for further multiselect picks
    inputRef.current?.focus();
  };

  const handleSelect = multiple ? toggleMulti : selectSingle;

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setOpen(true);
    // For single-select, clearing the input clears the selection
    if (!multiple && e.target.value && value) {
      onChange("");
    }
  };

  const handleInputFocus = () => {
    if (disabled) return;
    setFocused(true);
    setOpen(true);
    setQuery("");
  };

  const handleInputBlur = () => {
    setFocused(false);
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setOpen(false);
      }
    }, 150);
  };

  // What renders in the input
  const inputValue = open
    ? query
    : (multiple ? "" : (selectedOption?.label || ""));

  const accent = "#1a3a4a";
  const border = "rgba(26,58,74,0.14)";
  const muted = "#1a3a4a90";
  const text = "#1a3a4a";
  const surface = "#fff";
  const infoBg = "#f0f3f8";
  const surfaceAlt = "#fafcfb";

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={placeholder || "Select or type to search…"}
          autoComplete="off"
          disabled={disabled}
          style={{
            width: "100%",
            padding: "10px 36px 10px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            border: `1.5px solid ${focused ? accent : border}`,
            borderRadius: open ? "8px 8px 0 0" : 8,
            background: surface,
            color: text,
            outline: "none",
            boxSizing: "border-box",
            cursor: disabled ? "not-allowed" : "text",
            opacity: disabled ? 0.6 : 1,
          }}
        />
        <div
          onClick={() => {
            if (disabled) return;
            setOpen(!open);
            if (!open) inputRef.current?.focus();
          }}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
            transition: "transform 0.2s",
            cursor: disabled ? "not-allowed" : "pointer",
            color: muted,
            userSelect: "none",
            pointerEvents: disabled ? "none" : "auto",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: surface,
          border: `1.5px solid ${accent}`,
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 1000,
          maxHeight: 280,
          overflowY: "auto",
        }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: "12px 14px",
              fontSize: 13,
              color: muted,
              fontStyle: "italic",
            }}>
              {query
                ? `No options match "${query}"`
                : (multiple && selectedValues.length === options.length ? "All options selected" : "No options")}
            </div>
          ) : (
            filtered.map((opt) => {
              const isSelected = multiple
                ? selectedValues.includes(opt.value)
                : opt.value === value;
              return (
                <div
                  key={opt.value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(opt.value);
                  }}
                  style={{
                    padding: "10px 14px",
                    cursor: "pointer",
                    background: isSelected ? infoBg : "transparent",
                    borderLeft: isSelected ? `3px solid ${accent}` : "3px solid transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = surfaceAlt; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? infoBg : "transparent"; }}
                >
                  <div style={{
                    fontSize: 14,
                    fontWeight: isSelected ? 600 : 400,
                    color: text,
                  }}>
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
                      {opt.description}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {multiple && selectedValues.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {selectedValues.map((v) => {
            const opt = options.find((o) => o.value === v);
            const label = opt?.label || v;
            return (
              <span
                key={v}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: infoBg,
                  border: `1px solid ${border}`,
                  borderRadius: 999,
                  padding: "3px 8px 3px 10px",
                  fontSize: 12,
                  color: text,
                }}
              >
                {label}
                <button
                  type="button"
                  onClick={() => {
                    onChange(selectedValues.filter((x) => x !== v));
                  }}
                  aria-label={`Remove ${label}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    color: muted,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
