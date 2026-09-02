import React, { useMemo, useState } from "react";
import WizardCard from "../components/WizardCard";
import SourceRow from "../components/SourceRow";
import { adminColors, adminStyles } from "../adminDesign";
import { COUNTRIES, flagFor, countryName } from "../countries";

// Step 6 — Source Classification.
//
// Primary sources are grouped by jurisdiction; secondary is a flat list.
// Upload supports CSV (with template download) — non-CSV files surface an
// honest "AI extraction not wired up yet" notice and don't crash the UI.
// The xlsx parsing the spec mentions is deliberately deferred to avoid
// pulling a large dep into the bundle until it's actually needed.

const CSV_HEADERS = ["Country Code", "Country Name", "Source Name", "URL Pattern", "Primary/Secondary"];

export default function StepSources({ config, onChange, isStandalone = false }) {
  const tiers = config?.sourceTiers || { primary: [], secondary: [], documentsArePrimary: true };
  const [showInfo, setShowInfo] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [extractedSources, setExtractedSources] = useState(null);
  const [extractionError, setExtractionError] = useState(null);
  const [extractionLoading, setExtractionLoading] = useState(false);

  function patchTiers(p) {
    onChange({ sourceTiers: { ...tiers, ...p } });
  }

  function addPrimary(src) {
    patchTiers({ primary: [...(tiers.primary || []), { ...src, active: true }] });
  }
  function addSecondary(src) {
    patchTiers({ secondary: [...(tiers.secondary || []), { ...src, active: true }] });
  }

  function updatePrimary(idx, patch) {
    const next = (tiers.primary || []).slice();
    next[idx] = { ...next[idx], ...patch };
    patchTiers({ primary: next });
  }
  function updateSecondary(idx, patch) {
    const next = (tiers.secondary || []).slice();
    next[idx] = { ...next[idx], ...patch };
    patchTiers({ secondary: next });
  }
  function deletePrimary(idx) {
    const next = (tiers.primary || []).slice();
    next.splice(idx, 1);
    patchTiers({ primary: next });
  }
  function deleteSecondary(idx) {
    const next = (tiers.secondary || []).slice();
    next.splice(idx, 1);
    patchTiers({ secondary: next });
  }

  function downloadTemplate() {
    const rows = [CSV_HEADERS.join(",")];
    for (const s of tiers.primary || []) {
      rows.push(csvRow([
        s.jurisdiction || "",
        s.jurisdiction ? countryName(s.jurisdiction) : "Global",
        s.name,
        s.pattern,
        "Primary",
      ]));
    }
    for (const s of tiers.secondary || []) {
      rows.push(csvRow(["", "", s.name, s.pattern, "Secondary"]));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sources-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file) {
    setUploadedFile(file);
    setExtractedSources(null);
    setExtractionError(null);
  }

  async function processFile() {
    if (!uploadedFile) return;
    setExtractionLoading(true);
    setExtractionError(null);
    try {
      const name = uploadedFile.name.toLowerCase();
      if (name.endsWith(".csv")) {
        const text = await uploadedFile.text();
        const rows = parseCsv(text);
        const mapped = mapCsvToSources(rows);
        if (!mapped.length) throw new Error("No rows parsed — check that the CSV has the expected headers.");
        setExtractedSources(mapped);
      } else {
        setExtractionError(
          "AI extraction for non-CSV files isn't wired up yet. Download the template, paste your sources into it, and upload that instead."
        );
      }
    } catch (err) {
      setExtractionError(err.message);
    } finally {
      setExtractionLoading(false);
    }
  }

  function applyExtracted() {
    if (!extractedSources) return;
    const newPrimary = [...(tiers.primary || [])];
    const newSecondary = [...(tiers.secondary || [])];
    for (const s of extractedSources) {
      if (s.tier === "primary") {
        newPrimary.push({
          name: s.name,
          pattern: s.pattern,
          jurisdiction: s.jurisdiction || null,
          active: true,
        });
      } else {
        newSecondary.push({ name: s.name, pattern: s.pattern, active: true });
      }
    }
    patchTiers({ primary: newPrimary, secondary: newSecondary });
    setUploadedFile(null);
    setExtractedSources(null);
  }

  // Group primary by jurisdiction
  const primaryByCountry = useMemo(() => {
    const map = new Map();
    (tiers.primary || []).forEach((s, idx) => {
      const k = s.jurisdiction || "__global__";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ ...s, _idx: idx });
    });
    return map;
  }, [tiers.primary]);

  return (
    <WizardCard
      title="Source Classification"
      subtitle="Define which sources are treated as official (primary) and which require customer confirmation (secondary). Classification is country-based and applies globally across all entity types and licences."
    >
      <Banner open={showInfo} setOpen={setShowInfo}>
        Primary sources are official government registries and regulatory databases. Data found from these sources is shown as pre-filled and verified on the customer's Confirm page. Secondary sources require the customer to explicitly confirm the value before it is used.
      </Banner>

      <SectionHeading>Bulk upload</SectionHeading>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
        <UploadOption
          icon="⬇"
          title="Use our template"
          body="Download our CSV template, fill in your source list, and upload it."
          action={
            <button type="button" onClick={downloadTemplate} style={adminStyles.btnSecondary}>
              Download Template
            </button>
          }
          dropzone={
            <FileDrop
              accept=".csv,.xlsx"
              file={uploadedFile}
              onChange={handleFile}
              label="Upload completed template"
            />
          }
        />
        <UploadOption
          icon="⬆"
          title="Upload your own file"
          body="Upload your existing source policy in any format. Our AI will read it and map it to our format."
          action={null}
          dropzone={
            <>
              <button
                type="button"
                onClick={() => setShowGuidelines((v) => !v)}
                style={{ ...adminStyles.btnGhost, color: adminColors.textMuted, fontSize: 12, padding: 0, marginBottom: 8 }}
              >
                {showGuidelines ? "Hide guidelines ▴" : "Show guidelines ▾"}
              </button>
              {showGuidelines && (
                <div style={{ fontSize: 12, color: adminColors.textMuted, marginBottom: 10, padding: 10, background: adminColors.wizardBg, borderRadius: 8 }}>
                  Your file should tell us:
                  <ul style={{ margin: "4px 0 0 18px" }}>
                    <li>Country name or code</li>
                    <li>Source / registry name</li>
                    <li>Website or URL pattern</li>
                    <li>Whether it is official or unverified</li>
                  </ul>
                  We can read: Excel, CSV, Word, PDF
                </div>
              )}
              <div
                style={{
                  marginBottom: 8,
                  padding: 10,
                  background: adminColors.statusIncompleteBg,
                  border: `1px solid ${adminColors.amber}`,
                  borderRadius: 8,
                  fontSize: 11,
                  color: adminColors.statusIncomplete,
                }}
              >
                ⚠ AI extraction for custom files will be enhanced before client launch. Currently uses basic column mapping; CSV is the most reliable format.
              </div>
              <FileDrop
                accept=".xlsx,.csv,.pdf,.doc,.docx"
                file={uploadedFile}
                onChange={handleFile}
                label="Upload any file"
              />
            </>
          }
        />
      </div>

      {uploadedFile && !extractedSources && (
        <div style={{ marginTop: 12, padding: 12, border: `1px solid ${adminColors.border}`, borderRadius: 8, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>
              📄 {uploadedFile.name}{" "}
              <span style={{ color: adminColors.textMuted, fontSize: 11 }}>
                ({Math.round(uploadedFile.size / 1024)}KB)
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => { setUploadedFile(null); setExtractionError(null); }}
                style={{ ...adminStyles.btnGhost, color: adminColors.textMuted, fontSize: 12 }}
              >
                Clear
              </button>
              <button type="button" onClick={processFile} disabled={extractionLoading} style={adminStyles.btnPrimary}>
                {extractionLoading ? "Processing…" : "Process File"}
              </button>
            </div>
          </div>
          {extractionError && (
            <div style={{ marginTop: 10, padding: 8, background: "#fef2f2", color: adminColors.danger, fontSize: 12, borderRadius: 6 }}>
              {extractionError}
            </div>
          )}
        </div>
      )}

      {extractedSources && (
        <ExtractedPreview
          rows={extractedSources}
          onRowChange={(i, p) => {
            const next = extractedSources.slice();
            next[i] = { ...next[i], ...p };
            setExtractedSources(next);
          }}
          onRowDelete={(i) => {
            const next = extractedSources.slice();
            next.splice(i, 1);
            setExtractedSources(next);
          }}
          onCancel={() => { setExtractedSources(null); setUploadedFile(null); }}
          onApply={applyExtracted}
        />
      )}

      <SectionHeading style={{ marginTop: 26 }}>Primary Sources (Official)</SectionHeading>
      <p style={{ fontSize: 12, color: adminColors.textMuted, margin: "0 0 12px" }}>
        Data from these sources is shown as pre-verified on the customer Confirm page.
      </p>

      <PrimaryByCountry
        primaryByCountry={primaryByCountry}
        onUpdate={updatePrimary}
        onDelete={deletePrimary}
        onAdd={addPrimary}
      />

      <SectionHeading style={{ marginTop: 26 }}>Secondary Sources (Unverified)</SectionHeading>
      <p style={{ fontSize: 12, color: adminColors.textMuted, margin: "0 0 12px" }}>
        Data from these sources is shown with an amber badge and requires customer confirmation.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(tiers.secondary || []).map((s, idx) => (
          <SourceRow
            key={idx}
            source={s}
            showFlag={false}
            onToggleActive={(v) => updateSecondary(idx, { active: v })}
            onDelete={() => deleteSecondary(idx)}
          />
        ))}
        {!(tiers.secondary || []).length && (
          <div style={{ padding: 12, fontSize: 12, color: adminColors.textMuted }}>No secondary sources configured.</div>
        )}
      </div>
      <AddSourceForm onAdd={addSecondary} showCountry={false} />

      <div
        style={{
          marginTop: 26,
          padding: 14,
          border: `1px solid ${adminColors.border}`,
          borderRadius: 10,
          background: "#fff",
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        <input
          type="checkbox"
          checked={!!tiers.documentsArePrimary}
          onChange={(e) => patchTiers({ documentsArePrimary: e.target.checked })}
          style={{ marginTop: 4, width: 16, height: 16 }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Treat uploaded documents as primary sources</div>
          <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 3 }}>
            When enabled, data extracted from uploaded documents is shown with a navy 'Document' badge and treated as verified. When disabled, document data requires customer confirmation like secondary sources.
          </div>
        </div>
      </div>
    </WizardCard>
  );
}

function SectionHeading({ children, style }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: adminColors.textMuted, marginBottom: 10, ...style }}>
      {children}
    </div>
  );
}

function Banner({ open, setOpen, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "10px 14px",
          background: "rgba(11,61,145,0.06)",
          border: `1px solid rgba(11,61,145,0.16)`,
          borderRadius: 8,
          color: adminColors.brandBlue,
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ℹ How does source classification work? {open ? "▴" : "▾"}
      </button>
      {open && (
        <div style={{ marginTop: 6, padding: 12, fontSize: 12, color: adminColors.text, lineHeight: 1.55, background: "rgba(11,61,145,0.04)", borderRadius: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function UploadOption({ icon, title, body, action, dropzone }) {
  return (
    <div style={{ padding: 14, border: `1px solid ${adminColors.border}`, borderRadius: 10, background: "#fff" }}>
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: adminColors.textMuted, marginTop: 4, lineHeight: 1.45 }}>{body}</div>
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
      <div style={{ marginTop: 10 }}>{dropzone}</div>
    </div>
  );
}

function FileDrop({ accept, file, onChange, label }) {
  return (
    <label
      style={{
        display: "block",
        padding: "14px 12px",
        border: `1.5px dashed ${adminColors.borderStrong}`,
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "center",
        background: "#fff",
        fontSize: 12,
        color: adminColors.textMuted,
      }}
    >
      {file ? `Selected: ${file.name}` : label}
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0])}
        style={{ display: "none" }}
      />
    </label>
  );
}

function ExtractedPreview({ rows, onRowChange, onRowDelete, onCancel, onApply }) {
  return (
    <div style={{ marginTop: 14, padding: 14, border: `1px solid ${adminColors.border}`, borderRadius: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Preview — {rows.length} sources</div>
        <div style={{ fontSize: 11, color: adminColors.textMuted }}>Review and edit before applying.</div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: adminColors.textMuted }}>
              <th style={cell}>Country</th>
              <th style={cell}>Source</th>
              <th style={cell}>Pattern</th>
              <th style={cell}>Tier</th>
              <th style={{ ...cell, textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${adminColors.border}` }}>
                <td style={cell}>
                  <select
                    value={r.jurisdiction || ""}
                    onChange={(e) => onRowChange(i, { jurisdiction: e.target.value || null })}
                    style={{ ...adminStyles.input, fontSize: 11, padding: 4 }}
                  >
                    <option value="">(Global)</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </td>
                <td style={cell}>
                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => onRowChange(i, { name: e.target.value })}
                    style={{ ...adminStyles.input, fontSize: 12, padding: 4 }}
                  />
                </td>
                <td style={cell}>
                  <input
                    type="text"
                    value={r.pattern}
                    onChange={(e) => onRowChange(i, { pattern: e.target.value })}
                    style={{ ...adminStyles.input, fontSize: 12, padding: 4, fontFamily: "monospace" }}
                  />
                </td>
                <td style={cell}>
                  <select
                    value={r.tier}
                    onChange={(e) => onRowChange(i, { tier: e.target.value })}
                    style={{ ...adminStyles.input, fontSize: 12, padding: 4 }}
                  >
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                  </select>
                </td>
                <td style={{ ...cell, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => onRowDelete(i)}
                    style={{ background: "transparent", border: "none", color: adminColors.danger, cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
        <button type="button" onClick={onCancel} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
          Cancel — discard upload
        </button>
        <button type="button" onClick={onApply} style={adminStyles.btnPrimary}>
          Apply {rows.length} sources →
        </button>
      </div>
    </div>
  );
}

function PrimaryByCountry({ primaryByCountry, onUpdate, onDelete, onAdd }) {
  const [adding, setAdding] = useState(null); // jurisdiction code or "__new__"

  const keys = Array.from(primaryByCountry.keys()).sort((a, b) => {
    if (a === "__global__") return 1;
    if (b === "__global__") return -1;
    return a.localeCompare(b);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {keys.map((k) => {
        const items = primaryByCountry.get(k);
        return (
          <div key={k}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              {k === "__global__" ? "🌍 Global (all countries)" : `${flagFor(k)} ${countryName(k)}`}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((s) => (
                <SourceRow
                  key={s._idx}
                  source={s}
                  showFlag={false}
                  onToggleActive={(v) => onUpdate(s._idx, { active: v })}
                  onDelete={() => onDelete(s._idx)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAdding(k)}
              style={{ ...adminStyles.btnGhost, color: adminColors.brandBlue, fontSize: 12, marginTop: 6, padding: 0 }}
            >
              + Add source for {k === "__global__" ? "global" : countryName(k)}
            </button>
            {adding === k && (
              <AddSourceForm
                showCountry={false}
                presetCountry={k === "__global__" ? null : k}
                onCancel={() => setAdding(null)}
                onAdd={(src) => {
                  onAdd({ ...src, jurisdiction: k === "__global__" ? null : k });
                  setAdding(null);
                }}
              />
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setAdding("__new__")}
        style={{ ...adminStyles.btnSecondary, alignSelf: "flex-start" }}
      >
        + Add source for another country
      </button>
      {adding === "__new__" && (
        <AddSourceForm
          showCountry
          onCancel={() => setAdding(null)}
          onAdd={(src) => {
            onAdd(src);
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

function AddSourceForm({ onAdd, onCancel, showCountry, presetCountry }) {
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [country, setCountry] = useState(presetCountry || "");

  function submit() {
    if (!name.trim() || !pattern.trim()) {
      alert("Name and URL pattern are required.");
      return;
    }
    onAdd({ name: name.trim(), pattern: pattern.trim(), jurisdiction: showCountry ? country || null : presetCountry || null });
    setName("");
    setPattern("");
    setCountry(presetCountry || "");
  }

  return (
    <div style={{ marginTop: 10, padding: 12, border: `1px solid ${adminColors.border}`, borderRadius: 8, background: "#fff" }}>
      <div style={{ display: "grid", gridTemplateColumns: showCountry ? "120px 1fr 1fr" : "1fr 1fr", gap: 8 }}>
        {showCountry && (
          <select value={country} onChange={(e) => setCountry(e.target.value)} style={adminStyles.input}>
            <option value="">— Country —</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={name}
          placeholder="Source name"
          onChange={(e) => setName(e.target.value)}
          style={adminStyles.input}
        />
        <input
          type="text"
          value={pattern}
          placeholder="URL pattern (e.g. companieshouse, .gov.uk)"
          onChange={(e) => setPattern(e.target.value)}
          style={{ ...adminStyles.input, fontFamily: "monospace", fontSize: 12 }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={submit} style={adminStyles.btnPrimary}>Add</button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ ...adminStyles.btnGhost, color: adminColors.textMuted }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

const cell = { padding: "6px 8px", verticalAlign: "middle" };

function csvRow(cells) {
  return cells.map((c) => {
    const s = String(c == null ? "" : c);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }).join(",");
}

// Minimal CSV parser — supports quoted fields and escaped quotes; not
// production-grade for every CSV edge case but enough for the template format.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") {
        row.push(cur); rows.push(row);
        row = []; cur = "";
      } else if (ch === "\r") {
        // skip
      } else {
        cur += ch;
      }
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c && c.trim()));
}

function mapCsvToSources(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (label) => header.findIndex((h) => h === label.toLowerCase());
  const ccIdx = idx("Country Code");
  const nameIdx = idx("Source Name");
  const patternIdx = idx("URL Pattern");
  const tierIdx = idx("Primary/Secondary");
  return rows.slice(1).map((r) => {
    const name = (r[nameIdx] || "").trim();
    const pattern = (r[patternIdx] || "").trim();
    if (!name || !pattern) return null;
    const tier = ((r[tierIdx] || "").trim().toLowerCase().startsWith("p")) ? "primary" : "secondary";
    const jurisdiction = (r[ccIdx] || "").trim() || null;
    return { name, pattern, tier, jurisdiction };
  }).filter(Boolean);
}
