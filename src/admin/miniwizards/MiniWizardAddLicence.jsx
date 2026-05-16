import React, { useMemo, useState } from "react";
import MiniWizardShell from "./MiniWizardShell";
import StepSchemas from "../steps/StepSchemas";
import { adminColors, adminStyles } from "../adminDesign";
import { COUNTRIES, flagFor } from "../countries";

const STEPS = ["Licence Details", "Entity Types", "Configure Schemas", "Review"];

const BLANK_LICENCE = () => ({
  id: "lic_" + Date.now(),
  jurisdictionCode: "GB",
  jurisdictionName: "United Kingdom",
  licenceType: "",
  licenceNumber: "",
  regulatoryAuthority: "",
  countriesCovered: [],
  isPrimary: false,
});

// 4-step flow for adding a new licence: details → entity association →
// per-cell schema setup → review. Local working copy of config is mutated
// across steps and pushed back to the dashboard via onComplete on Done.
export default function MiniWizardAddLicence({ config, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [newLicence, setNewLicence] = useState(BLANK_LICENCE());
  const [selectedEntityIds, setSelectedEntityIds] = useState([]);
  const [workingConfig, setWorkingConfig] = useState(config);

  const entityTypes = (config?.entityTypes || []).filter((e) => e.active);

  function next() {
    if (step === 1) {
      if (!newLicence.jurisdictionCode || !newLicence.licenceType) {
        alert("Jurisdiction and licence type are required.");
        return;
      }
      const lic = {
        ...newLicence,
        jurisdictionName: COUNTRIES.find((c) => c.code === newLicence.jurisdictionCode)?.name || newLicence.jurisdictionCode,
      };
      setNewLicence(lic);
      setWorkingConfig((prev) => ({ ...prev, licences: [...(prev.licences || []), lic] }));
      setStep(2);
    } else if (step === 2) {
      if (!selectedEntityIds.length) {
        alert("Select at least one entity type to associate.");
        return;
      }
      setWorkingConfig((prev) => ({
        ...prev,
        entityTypes: (prev.entityTypes || []).map((e) =>
          selectedEntityIds.includes(e.id)
            ? { ...e, associatedLicenceIds: [...(e.associatedLicenceIds || []), newLicence.id] }
            : e
        ),
      }));
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    } else {
      finish();
    }
  }

  function finish() {
    onComplete(workingConfig, `Licence ${newLicence.jurisdictionName} added`);
  }

  function patchLicence(p) {
    setNewLicence({ ...newLicence, ...p });
  }

  function toggleEntity(id) {
    setSelectedEntityIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  function toggleCountryCovered(code) {
    const cur = new Set(newLicence.countriesCovered || []);
    if (cur.has(code)) cur.delete(code);
    else cur.add(code);
    patchLicence({ countriesCovered: Array.from(cur) });
  }

  const newCells = useMemo(() =>
    selectedEntityIds.map((eid) => `${eid}:${newLicence.id}`),
    [selectedEntityIds, newLicence.id]
  );

  const configuredCount = newCells.filter((c) => {
    const s = workingConfig?.schemas?.[c];
    return s && ((s.researchFields?.length || 0) + (s.gapFields?.length || 0)) > 0;
  }).length;

  return (
    <MiniWizardShell
      title="Add Licence"
      steps={STEPS}
      currentStep={step}
      onCancel={onCancel}
      onPrev={() => setStep(step - 1)}
      onNext={next}
      nextLabel={step === 4 ? "Done" : "Continue →"}
    >
      {step === 1 && (
        <Card title="Licence details">
          <Grid>
            <Field label="Jurisdiction Country">
              <select
                value={newLicence.jurisdictionCode}
                onChange={(e) => patchLicence({ jurisdictionCode: e.target.value })}
                style={adminStyles.input}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Regulatory Authority">
              <input type="text" value={newLicence.regulatoryAuthority} onChange={(e) => patchLicence({ regulatoryAuthority: e.target.value })} placeholder="e.g. FCA, MAS" style={adminStyles.input} />
            </Field>
            <Field label="Licence Type *">
              <input type="text" value={newLicence.licenceType} onChange={(e) => patchLicence({ licenceType: e.target.value })} placeholder="e.g. Payment Institution" style={adminStyles.input} />
            </Field>
            <Field label="Licence Number (optional)">
              <input type="text" value={newLicence.licenceNumber} onChange={(e) => patchLicence({ licenceNumber: e.target.value })} style={adminStyles.input} />
            </Field>
            <Field label="Countries Covered" full>
              <CountryChips selected={newLicence.countriesCovered || []} onToggle={toggleCountryCovered} />
            </Field>
          </Grid>
        </Card>
      )}

      {step === 2 && (
        <Card title="Which entity types does this licence support?">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {entityTypes.map((e) => (
              <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: `1px solid ${selectedEntityIds.includes(e.id) ? adminColors.niumBlue : adminColors.border}`, borderRadius: 8, cursor: "pointer", background: selectedEntityIds.includes(e.id) ? "rgba(11,61,145,0.04)" : "#fff" }}>
                <input type="checkbox" checked={selectedEntityIds.includes(e.id)} onChange={() => toggleEntity(e.id)} />
                <span style={{ fontSize: 14 }}>{e.icon} {e.label}</span>
                <span style={{ fontSize: 12, color: adminColors.textMuted, marginLeft: "auto" }}>{e.description}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      {step === 3 && (
        <div>
          <div style={{ fontSize: 13, color: adminColors.textMuted, marginBottom: 10 }}>
            Configure the schema for each new cell. You can skip any cell and configure it later from the dashboard.
          </div>
          <StepSchemas config={workingConfig} onChange={(p) => setWorkingConfig((prev) => ({ ...prev, ...p }))} />
          <div style={{ marginTop: 10, fontSize: 12, color: adminColors.textMuted }}>
            {configuredCount} of {newCells.length} new cells configured
          </div>
        </div>
      )}

      {step === 4 && (
        <Card title="Review">
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, lineHeight: 1.7 }}>
            <li><strong>New licence:</strong> {flagFor(newLicence.jurisdictionCode)} {newLicence.jurisdictionName} ({newLicence.licenceType})</li>
            <li><strong>Associated entity types:</strong> {selectedEntityIds.map((id) => entityTypes.find((e) => e.id === id)?.label || id).join(", ") || "—"}</li>
            <li><strong>Schemas configured:</strong> {configuredCount} of {newCells.length}</li>
            <li><strong>Countries covered:</strong> {(newLicence.countriesCovered || []).join(", ") || "(none — used as catch-all)"}</li>
          </ul>
          {configuredCount < newCells.length && (
            <div style={{ marginTop: 12, fontSize: 12, color: adminColors.statusIncomplete }}>
              You can configure remaining schemas later from the dashboard.
            </div>
          )}
        </Card>
      )}
    </MiniWizardShell>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: "#fff", padding: 16, border: `1px solid ${adminColors.border}`, borderRadius: 10 }}>
      {title && <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{title}</div>}
      {children}
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}

function Field({ label, full, children }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <label style={adminStyles.label}>{label}</label>
      {children}
    </div>
  );
}

function CountryChips({ selected, onToggle }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        maxHeight: 180,
        overflowY: "auto",
        padding: 8,
        border: `1px solid ${adminColors.border}`,
        borderRadius: 8,
        background: "#fff",
      }}
    >
      {COUNTRIES.map((c) => {
        const on = selected.includes(c.code);
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => onToggle(c.code)}
            style={{
              padding: "4px 10px",
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 600,
              border: `1px solid ${on ? adminColors.niumBlue : adminColors.border}`,
              background: on ? adminColors.niumBlue : "#fff",
              color: on ? "#fff" : adminColors.text,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {flagFor(c.code)} {c.code}
          </button>
        );
      })}
    </div>
  );
}
