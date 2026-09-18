import React, { useMemo, useState } from "react";
import { INVESTIGATION_TOPIC_REGISTRY } from "./customer/investigationTopics";

function label(value) { return String(value || "").replaceAll("_", " ").toLowerCase(); }

export default function AnalystInvestigationTopics({ activations = [], trace, onActivate, onCancel }) {
  const [previewCode, setPreviewCode] = useState(null);
  const [editing, setEditing] = useState(false);
  const [wording, setWording] = useState("");
  const groups = useMemo(() => INVESTIGATION_TOPIC_REGISTRY.reduce((result, topic) => {
    (result[topic.group] ||= []).push(topic);
    return result;
  }, {}), []);
  const active = new Map(activations.filter(({ status }) => status === "ACTIVE").map((item) => [item.topicCode, item]));
  const openPreview = (topic) => { setPreviewCode(topic.code); setEditing(false); setWording(topic.preview); };
  return <section className="ubo-demo-topic-panel" aria-labelledby="investigation-topics-title">
    <div className="ubo-demo-section-heading"><div><span className="ubo-demo-eyebrow">Analyst investigation</span><h2 id="investigation-topics-title">Investigation topics</h2><p>Select a structured issue. It enters the existing Questions &amp; Resolution Engine and only asks customer follow-ups that remain relevant.</p></div></div>
    <div className="ubo-demo-topic-groups">{Object.entries(groups).map(([group, topics]) => <section key={group}>
      <h3>{group}</h3><div>{topics.map((topic) => {
        const activation = active.get(topic.code);
        return <article key={topic.code} className={!topic.active ? "disabled" : activation ? "active" : ""}>
          <div><strong>{topic.label}</strong><small>{topic.preview}</small></div>
          {!topic.active ? <span>Reserved</span> : activation ? <><span className="ubo-demo-topic-status">{label(activation.displayStatus || "QUEUED")}</span><button type="button" onClick={() => onCancel(activation.id)}>Remove</button></> : <button type="button" onClick={() => openPreview(topic)}>Ask customer</button>}
        </article>;
      })}</div>
    </section>)}</div>
    {previewCode && (() => {
      const topic = INVESTIGATION_TOPIC_REGISTRY.find(({ code }) => code === previewCode);
      return <div className="ubo-demo-topic-preview" role="dialog" aria-modal="false" aria-labelledby="topic-preview-title">
        <span className="ubo-demo-eyebrow">Question-pack preview</span><h3 id="topic-preview-title">Ask customer about {topic.label.toLowerCase()}</h3>
        {editing ? <label><span>Customer-facing root wording</span><textarea value={wording} onChange={(event) => setWording(event.target.value)} /></label> : <p>{wording}</p>}
        <small>Follow-up questions will only appear where relevant. Editing this wording does not change the structured Fact Requirement.</small>
        <div><button type="button" className="ubo-demo-primary" onClick={() => { onActivate(topic.code, wording === topic.preview ? undefined : wording); setPreviewCode(null); }}>Add to customer questions</button><button type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Use wording" : "Edit wording"}</button><button type="button" onClick={() => setPreviewCode(null)}>Cancel</button></div>
      </div>;
    })()}
    {trace && <details className="ubo-demo-topic-trace"><summary>Customer investigation trace</summary><div>
      <dl><dt>Ownership stage</dt><dd>{label(trace.ownershipResolution?.status)}</dd><dt>Control stage</dt><dd>{label(trace.controlResolution?.status)}</dd><dt>Fallback</dt><dd>{label(trace.fallback?.outcome || "not required")}</dd></dl>
      {(trace.uboAssessments || []).map((assessment) => <article key={assessment.personId}><strong>{assessment.personName}</strong><span>{assessment.determination} · {(assessment.bases || []).map(label).join(", ")}</span><small>IDV {assessment.idvRequired ? "required" : "not required"}</small></article>)}
      {(trace.questions || []).map((question) => <article key={question.id}><strong>{question.prompt}</strong><span>{label(question.status)}{question.answer !== undefined ? ` · ${question.answer}` : ""}</span><small>{(question.originTypes || []).map(label).join(", ")}</small></article>)}
      {trace.fallback?.reason && <p><strong>Fallback reason:</strong> {trace.fallback.reason}</p>}
    </div></details>}
  </section>;
}
