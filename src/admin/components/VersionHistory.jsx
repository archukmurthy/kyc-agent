import React, { useEffect, useState } from "react";
import { adminColors, adminStyles } from "../adminDesign";

// Pulls /api/config-versions and lists archived configs. Rollback POSTs the
// chosen version back through /api/config-versions (server treats POST with
// {version} as a rollback request).
export default function VersionHistory({ token, currentVersion, onRolledBack }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // version number being rolled back

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/config-versions", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setVersions(data.versions || []);
    } catch (err) {
      setError(err.message);
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, currentVersion]);

  async function rollback(v) {
    if (!window.confirm(`Roll back to v${v}? This will replace your current configuration. Your current version will still be saved as v${currentVersion}.`)) {
      return;
    }
    setBusy(v);
    try {
      const r = await fetch("/api/config-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ version: v }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (onRolledBack) onRolledBack(data.version);
      load();
    } catch (err) {
      alert("Rollback failed: " + err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Version History</div>
        <button type="button" onClick={load} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted, fontSize: 12 }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: adminColors.textMuted, padding: 10, background: adminColors.wizardBg, borderRadius: 8 }}>
          Could not load version history ({error}). KV may not be provisioned yet.
        </div>
      )}

      {!error && versions.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: adminColors.textMuted, padding: 10, background: adminColors.wizardBg, borderRadius: 8 }}>
          No archived versions yet. Versions are created automatically each time you publish.
        </div>
      )}

      {versions.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: adminColors.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={cell}>Version</th>
              <th style={cell}>Published</th>
              <th style={cell}>Counts</th>
              <th style={cell}>Status</th>
              <th style={{ ...cell, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const isCurrent = currentVersion && v.version === currentVersion;
              return (
                <tr key={v.version} style={{ borderTop: `1px solid ${adminColors.border}` }}>
                  <td style={cell}>v{v.version}</td>
                  <td style={cell}>{v.publishedAt ? new Date(v.publishedAt).toLocaleString() : "—"}</td>
                  <td style={cell}>
                    {v.entityTypeCount ?? "—"} ET · {v.licenceCount ?? "—"} lic · {v.schemaCount ?? "—"} schemas
                  </td>
                  <td style={cell}>
                    {isCurrent ? (
                      <span style={{ ...adminStyles.statusBadge("complete"), fontSize: 10 }}>CURRENT</span>
                    ) : (
                      <span style={{ ...adminStyles.statusBadge("empty"), fontSize: 10 }}>ARCHIVED</span>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    {isCurrent ? (
                      <span style={{ color: adminColors.textMuted, fontSize: 11 }}>—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => rollback(v.version)}
                        disabled={busy === v.version}
                        style={{ ...adminStyles.btnSecondary, padding: "4px 10px", fontSize: 11 }}
                      >
                        {busy === v.version ? "Rolling back…" : "Rollback"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cell = { padding: "8px 10px", verticalAlign: "middle" };
