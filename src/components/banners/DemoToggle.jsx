// Small unobtrusive chip-shaped toggle used on the journey-selection screen.
// Only mounted when demoToggleVisible is true (localhost / ?demo / ?tenant).
export function DemoToggle({ on, onChange }) {
  return (
    <label
      title="Skip API calls and pre-fill the flow with sample data — for demos and testing"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        border: `1.5px dashed ${on ? "#92400E" : "rgba(26,58,74,0.18)"}`,
        background: on ? "#FEF3C7" : "transparent",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: on ? "#92400E" : "#1a3a4a90",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: "inherit",
      }}
    >
      <span>🧪 Demo mode</span>
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 14,
          borderRadius: 999,
          background: on ? "#FCD34D" : "rgba(26,58,74,0.25)",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: on ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
      />
    </label>
  );
}
