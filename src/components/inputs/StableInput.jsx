import { useState, useEffect, useCallback, useRef } from "react";
import { normaliseDate } from "../../pipeline";

// Module-scoped input that keeps its own local state and only writes through
// to the parent's gap ref via onUpdate — the form has 20+ fields and lifting
// values into parent React state caused re-renders that lost focus while
// typing. See AGENTS.md / CLAUDE.md: do not lift these values into useState.
export function StableInput({ id, label, type, value, onUpdate, required, options, placeholder }) {
  const ref = useRef(null);
  // Normalise the type so case/whitespace differences (e.g. "Date", " date ")
  // don't cause the wrong branch to render. Empty / unknown types fall back
  // to "text".
  const t = String(type || "text").toLowerCase().trim();
  // For date inputs, the browser requires YYYY-MM-DD; coerce here so an AI-
  // returned value like "12 January 2005" populates the picker correctly.
  const initial = t === "date" ? (normaliseDate(value) || "") : (value || "");
  const [local, setLocal] = useState(initial);
  useEffect(() => {
    setLocal(t === "date" ? (normaliseDate(value) || "") : (value || ""));
  }, [value, t]);
  const handleChange = useCallback((e) => { const v = e.target.value; setLocal(v); onUpdate(id, v); }, [id, onUpdate]);
  const sty = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", outline: "none", boxSizing: "border-box" };

  const renderInput = () => {
    switch (t) {
      case "select":
        return (
          <select ref={ref} value={local} onChange={handleChange} style={{ ...sty, cursor: "pointer" }}>
            <option value="">Select...</option>
            {(options || []).map((o, i) => {
              // Support both shapes: legacy hardcoded gap fields use plain
              // strings (e.g. ["Yes","No"]); admin-saved fields use
              // { value, label } objects.
              const isObj = o && typeof o === "object";
              const optValue = isObj
                ? (o.value !== undefined && o.value !== null ? o.value : o.label)
                : o;
              const optLabel = isObj
                ? (o.label !== undefined && o.label !== null ? o.label : String(o.value))
                : o;
              return <option key={`${optValue}-${i}`} value={optValue}>{optLabel}</option>;
            })}
          </select>
        );
      case "textarea":
        return (
          <textarea ref={ref} value={local} onChange={handleChange} placeholder={placeholder} rows={3} style={{ ...sty, resize: "vertical" }} />
        );
      case "file":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              ref={ref}
              type="file"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                const name = f ? f.name : "";
                setLocal(name);
                onUpdate(id, name);
              }}
              style={{ ...sty, padding: "8px 10px", cursor: "pointer" }}
            />
            {local && <span style={{ fontSize: 11, color: "#4a9e8e", fontWeight: 600, whiteSpace: "nowrap" }}>✓ {local}</span>}
          </div>
        );
      case "date":
        return (
          <input ref={ref} type="date" value={local} onChange={handleChange} style={sty} />
        );
      case "number":
        return (
          <input ref={ref} type="number" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "email":
        return (
          <input ref={ref} type="email" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "tel":
        return (
          <input ref={ref} type="tel" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "text":
      default:
        return (
          <input ref={ref} type="text" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      {renderInput()}
    </div>
  );
}
