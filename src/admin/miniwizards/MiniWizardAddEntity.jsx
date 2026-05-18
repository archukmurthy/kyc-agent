import React, { useMemo, useState } from "react";
import MiniWizardShell from "./MiniWizardShell";
import StepSchemas from "../steps/StepSchemas";
import StepDocuments from "../steps/StepDocuments";
import { adminColors, adminStyles } from "../adminDesign";
import { flagFor } from "../countries";

const STEPS = ["Entity Details", "Licence Association", "Field Schema", "Documents", "Review"];

function slugId(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32) || "entity_" + Date.now();
}

const BLANK = () => ({
  id: "",
  label: "",
  description: "",
  icon: "🏢",
  active: true,
  sortOrder: 99,
  associatedLicenceIds: [],
});

// 5-step flow: new entity type → licence pickers → schema cells → docs → review.
export default function MiniWizardAddEntity({ config, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(BLANK());
  const [workingConfig, setWorkingConfig] = useState(config);

  const licences = config?.licences || [];

  function patch(p) {
    setDraft({ ...draft, ...p });
  }

  function toggleLicence(licId) {
    const cur = new Set(draft.associatedLicenceIds || []);
    if (cur.has(licId)) cur.delete(licId);
    else cur.add(licId);
    patch({ associatedLicenceIds: Array.from(cur) });
  }

  function next() {
    if (step === 1) {
      if (!draft.label.trim()) {
        alert("Label is required.");
        return;
      }
      const id = draft.id || slugId(draft.label);
      const newEnt = { ...draft, id, sortOrder: (config.entityTypes || []).length + 1 };
      setDraft(newEnt);
      setWorkingConfig((prev) => ({
        ...prev,
        entityTypes: [...(prev.entityTypes || []), newEnt],
      }));
      setStep(2);
    } else if (step === 2) {
      if (!draft.associatedLicenceIds?.length) {
        alert("Select at least one licence.");
        return;
      }
      setWorkingConfig((prev) => ({
        ...prev,
        entityTypes: (prev.entityTypes || []).map((e) =>
          e.id === draft.id ? { ...e, associatedLicenceIds: draft.associatedLicenceIds } : e
        ),
      }));
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      setStep(5);
    } else {
      onComplete(workingConfig, `Entity type ${draft.label} added`);
    }
  }

  const newCells = useMemo(() =>
    (draft.associatedLicenceIds || []).map((lid) => `${draft.id}:${lid}`),
    [draft.associatedLicenceIds, draft.id]
  );

  const configuredCount = newCells.filter((c) => {
    const s = workingConfig?.schemas?.[c];
    return s && ((s.researchFields?.length || 0) + (s.gapFields?.length || 0)) > 0;
  }).length;

  return (
    <MiniWizardShell
      title="Add Entity Type"
      steps={STEPS}
      currentStep={step}
      onCancel={onCancel}
      onPrev={() => setStep(step - 1)}
      onNext={next}
      nextLabel={step === 5 ? "Done" : "Continue →"}
    >
      {step === 1 && (
        <Card title="Entity details">
          <Grid>
            <Field label="Label *">
              <input type="text" value={draft.label} onChange={(e) => patch({ label: e.target.value })} style={adminStyles.input} />
            </Field>
            <Field label="Icon (emoji)">
              <input type="text" value={draft.icon} maxLength={4} onChange={(e) => patch({ icon: e.target.value })} style={adminStyles.input} />
            </Field>
            <Field label="Description" full>
              <input type="text" value={draft.description} onChange={(e) => patch({ description: e.target.value })} style={adminStyles.input} />
            </Field>
            <Field label="Active" full>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={draft.active !== false} onChange={(e) => patch({ active: e.target.checked })} />
                Show this entity type on the customer flow
              </label>
            </Field>
          </Grid>
        </Card>
      )}

      {step === 2 && (
        <Card title="Which licences support this entity type?">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {licences.map((l) => (
              <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: `1px solid ${draft.associatedLicenceIds?.includes(l.id) ? adminColors.niumBlue : adminColors.border}`, borderRadius: 8, cursor: "pointer", background: draft.associatedLicenceIds?.includes(l.id) ? "rgba(11,61,145,0.04)" : "#fff" }}>
                <input type="checkbox" checked={draft.associatedLicenceIds?.includes(l.id) || false} onChange={() => toggleLicence(l.id)} />
                <span style={{ fontSize: 14 }}>
                  {flagFor(l.jurisdictionCode)} {l.jurisdictionName}
                  {l.regulatoryAuthority ? ` (${l.regulatoryAuthority})` : ""}
                </span>
              </label>
            ))}
            {!licences.length && (
              <div style={{ padding: 10, fontSize: 12, color: adminColors.textMuted }}>
                No licences configured yet. Add one in Step 2 of the main wizard first.
              </div>
            )}
          </div>
        </Card>
      )}

      {step === 3 && (
        <div>
          <div style={{ fontSize: 13, color: adminColors.textMuted, marginBottom: 10 }}>
            Configure schemas for the new {newCells.length} cell{newCells.length === 1 ? "" : "s"}. You can skip cells and configure them later.
          </div>
          <StepSchemas config={workingConfig} onChange={(p) => setWorkingConfig((prev) => ({ ...prev, ...p }))} />
          <div style={{ marginTop: 10, fontSize: 12, color: adminColors.textMuted }}>
            {configuredCount} of {newCells.length} new cells configured
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ fontSize: 13, color: adminColors.textMuted, marginBottom: 10 }}>
            Pick which documents you&apos;ll collect for {draft.label}. You can change this anytime later.
          </div>
          <StepDocuments
            config={workingConfig}
            onChange={(p) => setWorkingConfig((prev) => ({ ...prev, ...p }))}
            initialEntityTypeId={draft.id}
          />
        </div>
      )}

      {step === 5 && (() => {
        const newDocs = workingConfig?.documents?.[draft.id] || [];
        return (
          <Card title="Review">
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13, lineHeight: 1.7 }}>
              <li><strong>Entity type:</strong> {draft.icon} {draft.label}</li>
              <li><strong>Licences:</strong> {(draft.associatedLicenceIds || []).map((id) => licences.find((l) => l.id === id)?.jurisdictionName || id).join(", ")}</li>
              <li><strong>Schemas configured:</strong> {configuredCount} of {newCells.length}</li>
              <li>
                <strong>Documents:</strong> {newDocs.length} configured
              </li>
            </ul>
            {newDocs.length > 0 ? (
              <ul style={{ margin: "10px 0 0 0", padding: "0 0 0 20px", fontSize: 12, color: adminColors.textMuted, lineHeight: 1.7 }}>
                {newDocs.map((d) => (
                  <li key={d.id}>{d.icon || "📄"} {d.name}{d.required ? " (required)" : ""}</li>
                ))}
              </ul>
            ) : (
              <div style={{ marginTop: 10, padding: 10, background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, fontSize: 12, color: "#92400E", display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                <span>⚠ No documents configured for {draft.label}</span>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  style={{ ...adminStyles.btnGhost, fontSize: 12, color: "#92400E", padding: "4px 10px" }}
                >
                  Configure documents →
                </button>
              </div>
            )}
          </Card>
        );
      })()}
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
