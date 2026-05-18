import React, { useMemo, useState } from "react";
import MiniWizardShell from "./MiniWizardShell";
import StepSchemas from "../steps/StepSchemas";
import { adminColors, adminStyles } from "../adminDesign";
import { flagFor } from "../countries";

const STEPS = ["Select Cell", "Configure Schema", "Review"];

// 3-step flow for the dashboard "+ Add Field Schema" action. Lets the admin
// pick a cell (preferring gaps) and configure it inline; closes back to the
// dashboard on Done. Reuses StepSchemas for the actual editor so the UX matches
// the main wizard.
export default function MiniWizardAddSchema({ config, preselectedCell = null, onComplete, onCancel }) {
  const [step, setStep] = useState(preselectedCell ? 2 : 1);
  const [selectedCell, setSelectedCell] = useState(preselectedCell);
  const [workingConfig, setWorkingConfig] = useState(config);
  const [pickedEntity, setPickedEntity] = useState("");
  const [pickedLicence, setPickedLicence] = useState("");

  const entityTypes = useMemo(
    () => (config?.entityTypes || []).filter((e) => e.active),
    [config?.entityTypes]
  );
  const licences = useMemo(() => config?.licences || [], [config?.licences]);

  const matrixCells = useMemo(() => {
    const cells = [];
    entityTypes.forEach((e) => {
      (e.associatedLicenceIds || []).forEach((lid) => {
        const key = `${e.id}:${lid}`;
        const s = config.schemas?.[key];
        const has = s && ((s.researchFields?.length || 0) + (s.gapFields?.length || 0)) > 0;
        cells.push({
          key,
          entityLabel: e.label,
          entityIcon: e.icon,
          licenceCode: licences.find((l) => l.id === lid)?.jurisdictionCode || lid,
          licenceName: licences.find((l) => l.id === lid)?.jurisdictionName || lid,
          configured: has,
        });
      });
    });
    return cells;
  }, [entityTypes, licences, config.schemas]);

  function commitSelection() {
    if (selectedCell) {
      ensureAssociation(selectedCell);
      return setStep(2);
    }
    if (!pickedEntity || !pickedLicence) {
      alert("Pick a cell or use the dropdowns to select entity and licence.");
      return;
    }
    const cellKey = `${pickedEntity}:${pickedLicence}`;
    ensureAssociation(cellKey);
    setSelectedCell(cellKey);
    setStep(2);
  }

  // If the chosen entity isn't yet associated with the chosen licence, add
  // the association now. Otherwise the schema saves into config.schemas but
  // the matrix won't show it (associatedLicenceIds gates cell visibility).
  function ensureAssociation(cellKey) {
    const [entityId, licenceId] = cellKey.split(":");
    setWorkingConfig((prev) => {
      const types = prev?.entityTypes || [];
      const ent = types.find((e) => e.id === entityId);
      if (!ent) return prev;
      const lids = ent.associatedLicenceIds || [];
      if (lids.includes(licenceId)) return prev;
      return {
        ...prev,
        entityTypes: types.map((e) =>
          e.id === entityId
            ? { ...e, associatedLicenceIds: [...lids, licenceId] }
            : e
        ),
      };
    });
  }

  function next() {
    if (step === 1) commitSelection();
    else if (step === 2) setStep(3);
    else onComplete(workingConfig, `Schema for ${selectedCell} configured`);
  }

  const cellSchema = workingConfig?.schemas?.[selectedCell];
  const counts = cellSchema
    ? {
        r: cellSchema.researchFields?.length || 0,
        g: cellSchema.gapFields?.length || 0,
      }
    : { r: 0, g: 0 };

  return (
    <MiniWizardShell
      title="Add / Configure Schema"
      steps={STEPS}
      currentStep={step}
      onCancel={onCancel}
      onPrev={() => setStep(step - 1)}
      onNext={next}
      nextLabel={step === 3 ? "Done" : "Continue →"}
    >
      {step === 1 && (
        <Card title="Which combination do you want to configure?">
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <select value={pickedEntity} onChange={(e) => setPickedEntity(e.target.value)} style={adminStyles.input}>
              <option value="">— Entity type —</option>
              {entityTypes.map((e) => (
                <option key={e.id} value={e.id}>{e.icon} {e.label}</option>
              ))}
            </select>
            <select value={pickedLicence} onChange={(e) => setPickedLicence(e.target.value)} style={adminStyles.input}>
              <option value="">— Licence —</option>
              {licences.map((l) => (
                <option key={l.id} value={l.id}>{l.jurisdictionName}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: adminColors.textMuted, marginBottom: 6 }}>
            Or pick from the matrix
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            {matrixCells.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedCell(c.key)}
                style={{
                  textAlign: "left",
                  padding: 10,
                  border: `1.5px solid ${selectedCell === c.key ? adminColors.niumBlue : adminColors.border}`,
                  borderRadius: 10,
                  background: c.configured ? adminColors.statusCompleteBg : adminColors.statusIncompleteBg,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {c.entityIcon} {c.entityLabel}
                </div>
                <div style={{ fontSize: 11, color: adminColors.textMuted, marginTop: 4 }}>
                  × {flagFor(c.licenceCode)} {c.licenceName}
                </div>
                <div style={{ fontSize: 11, marginTop: 4, color: c.configured ? adminColors.statusComplete : adminColors.statusIncomplete }}>
                  {c.configured ? "✅ Configured" : "⚠ No schema"}
                </div>
              </button>
            ))}
            {!matrixCells.length && (
              <div style={{ padding: 12, fontSize: 12, color: adminColors.textMuted }}>
                No cells available. Add an entity type and a licence first.
              </div>
            )}
          </div>
        </Card>
      )}

      {step === 2 && (
        <StepSchemas
          config={workingConfig}
          onChange={(p) => setWorkingConfig((prev) => ({ ...prev, ...p }))}
          preselectedCell={selectedCell}
        />
      )}

      {step === 3 && (
        <Card title="Review">
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, lineHeight: 1.7 }}>
            <li><strong>Cell:</strong> {selectedCell}</li>
            <li><strong>Research fields:</strong> {counts.r}</li>
            <li><strong>Gap fields:</strong> {counts.g}</li>
          </ul>
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
