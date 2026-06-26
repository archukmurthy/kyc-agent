/**
 * ChangeDialogue.jsx — the capture-mode micro-dialogue shown inline beneath an
 * unchecked field on the Confirm page.
 *
 * Job (the WHOLE job): capture the customer's intent + registry answers, call
 * the pure classification engine, and EMIT EXACTLY ONE change_event via onEvent.
 * It records; it does not route the journey. An UNDECIDED engine outcome is a
 * recorded, analyst-bound result — never a dead-end, never a guess.
 *
 * Boundaries (enforced by the prop surface — keep it this way):
 *  - Write-only w.r.t. changes: the only thing leaving the component is the
 *    finished event, via onEvent. It imports NOTHING from Fill Gaps and exposes
 *    no Fill-Gaps-mutating prop. The amendment-document list is a derived read
 *    off the event store in a later slice — not injected from here.
 *  - All transient state is local (useDialogueState), so answering one field
 *    never re-renders the Confirm table.
 *
 * When the compliance rules land, they slot into the engine's policy table and
 * this component upgrades automatically — because it already routes on the
 * engine's output, not on hardcoded outcomes.
 */

import React, { useEffect, useRef, useState } from 'react';
import { classifyChange } from '../../changeIntelligence/classifyChange';
import { buildChangeEvent } from './buildChangeEvent';
import { useDialogueState } from './useDialogueState';
import {
  classifyFieldClass,
  deriveVerifiability,
  deriveSource,
  planSteps,
  questionFor,
  toEngineChangeType,
} from './dialogueContent';

const PANEL = {
  marginTop: 8,
  padding: '10px 12px',
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  fontSize: 13,
  color: '#1a3a4a',
  lineHeight: 1.5,
};
const PROMPT = { fontWeight: 600, marginBottom: 8, fontSize: 13 };
const OPTION_ROW = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const OPTION_BTN = {
  cursor: 'pointer',
  padding: '6px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#1a3a4a',
  background: '#fff',
  border: '1px solid #CBD5E1',
  borderRadius: 6,
};
const NOTICE_NEUTRAL = { ...PANEL, background: '#F1F5F9', borderColor: '#CBD5E1' };
const NOTICE_DOC = {
  ...PANEL,
  background: '#FEF9EF',
  borderColor: '#FCD9A8',
  color: '#7a4f00',
};

export function ChangeDialogue({
  field = {},
  jurisdiction = 'GB',
  submissionId = null,
  dossierId = null,
  onEvent,
  onResolved,
}) {
  // Resolve engine metadata from the raw Confirm row once (stable per instance).
  const fieldClass = field.fieldClass || classifyFieldClass(field.fieldId);
  const verifiability = deriveVerifiability(field);
  const steps = planSteps(fieldClass, verifiability);

  const { stepKey, answers, recordAnswer, isComplete } = useDialogueState(steps);
  const [outcome, setOutcome] = useState(null);
  const emittedRef = useRef(false);

  useEffect(() => {
    if (!isComplete || emittedRef.current) return;
    emittedRef.current = true; // emit EXACTLY ONCE per completed dialogue

    const intent = answers.intent ?? null;
    const registryStatus = answers.registry ?? 'unknown';
    const engineChangeType = toEngineChangeType(fieldClass, intent);

    const engineResult = classifyChange({
      fieldClass,
      changeType: engineChangeType,
      intent,
      registryStatus,
      verifiability,
      jurisdiction,
    });

    const src = deriveSource(field);
    const event = buildChangeEvent({
      field: {
        fieldId: field.fieldId,
        fieldClass,
        value: field.value,
        sourceType: src.sourceType,
        sourceProvider: src.sourceProvider,
        sourceTier: src.sourceTier,
        verifiability,
      },
      jurisdiction,
      submissionId,
      dossierId,
      storedChangeType: 'changed', // unchecked found value; final form lands at Fill Gaps
      intent,
      registryStatus,
      engineResult,
    });

    // Durable write: persist this one change_event to the append-only store via
    // the real Neon-backed route. Fire-and-forget — capture must NEVER block the
    // customer (mirrors App.js#trackEvent). This is the dialogue fulfilling its
    // one job ("EMIT EXACTLY ONE change_event"); onEvent stays a pure analytics
    // notification. writeEvent server-side rejects a malformed/identifier-less
    // event with a 200 + warning, so a missing submissionId can't break the UI.
    if (typeof fetch === 'function') {
      fetch('/api/change-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch((err) => console.warn('[ChangeDialogue] persist failed:', err));
    }

    if (typeof onEvent === 'function') onEvent(event);
    if (typeof onResolved === 'function') onResolved(engineResult);
    setOutcome(engineResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // ── Still asking questions ──
  if (!isComplete) {
    const q = questionFor(stepKey, fieldClass);
    if (!q) return null; // defensive: a planned step with no question
    return (
      <div style={PANEL} data-testid="change-dialogue-question">
        <div style={PROMPT}>{q.prompt}</div>
        <div style={OPTION_ROW}>
          {q.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              style={OPTION_BTN}
              onClick={() => recordAnswer(stepKey, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Finalised: render the notice per the engine outcome ──
  if (!outcome) return null;

  // doc_required is the ONLY non-neutral customer-facing treatment. Everything
  // else — ops_review, escalation (NEVER revealed), analyst_review, UNDECIDED,
  // restart, re_derive — gets the same neutral "noted, we'll review" message.
  const isDocRequired = outcome.workflow === 'doc_required' && outcome.docType;

  if (isDocRequired) {
    return (
      <div style={NOTICE_DOC} data-testid="change-dialogue-notice">
        Because of this change, we’ve added <strong>{outcome.docType}</strong> to your
        checklist — you’ll upload it on the next page.
      </div>
    );
  }

  return (
    <div style={NOTICE_NEUTRAL} data-testid="change-dialogue-notice">
      Noted — we’ll review this. No action needed from you right now.
    </div>
  );
}

export default ChangeDialogue;
