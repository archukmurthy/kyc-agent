// Fixed-top banner shown to the customer flow whenever ?preview=true is set
// (or path is /preview). Two modes:
//   - normal blue: staged config loaded from sessionStorage; shows capture
//     timestamp and Close + Refresh controls
//   - amber: preview requested but no staged config in sessionStorage (e.g.
//     someone shared a /?preview=true link). Falls back to the published
//     config and offers a link into /admin to stage a real preview.
export function PreviewBanner({ missing, timestamp }) {
  const bg = missing ? "#B45309" : "#0B3D91";
  const btnBase = {
    background: "rgba(255,255,255,0.2)",
    border: "1px solid rgba(255,255,255,0.4)",
    color: "#fff",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  let capturedAt = "";
  if (timestamp) {
    try { capturedAt = ` — captured at ${new Date(timestamp).toLocaleTimeString()}`; }
    catch (_) { capturedAt = ""; }
  }
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: bg, color: "#FFFFFF",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 20px",
      fontSize: 13, fontWeight: 600, fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          background: "#FFFFFF", color: bg,
          fontSize: 11, fontWeight: 800,
          padding: "2px 8px", borderRadius: 99, letterSpacing: "0.5px",
        }}>PREVIEW</span>
        <span>
          {missing
            ? "No preview config found — showing published version instead."
            : `Previewing unpublished changes${capturedAt}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>
          {missing
            ? "Use the admin Preview button to stage your changes."
            : "This is not the live version. Submissions are disabled."}
        </span>
        {missing && (
          <button
            type="button"
            onClick={() => window.open("/admin", "_blank")}
            style={btnBase}
          >
            Go to admin →
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={btnBase}
          title="Reload to pick up the latest staged config"
        >
          ↻ Refresh
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          style={btnBase}
        >
          Close Preview ✕
        </button>
      </div>
    </div>
  );
}
