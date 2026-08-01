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
import { fieldHasHighRiskCountry } from '../../changeIntelligence/highRiskCountries';
// Notice is no longer rendered here — both finalised outcomes are silent, and
// the row itself carries the result. Re-add the import if a notice ever returns.
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

export function ChangeDialogue({
  field = {},
  jurisdiction = 'GB',
  submissionId = null,
  dossierId = null,
  onEvent,
  onResolved,
  persisted = null,
  onPersist,
}) {
  // Resolve engine metadata from the raw Confirm row once (stable per instance).
  const fieldClass = field.fieldClass || classifyFieldClass(field.fieldId);
  const verifiability = deriveVerifiability(field);
  const steps = planSteps(fieldClass, verifiability);

  // Seed from the lifted (durable) snapshot so a return visit to Confirm resumes
  // instead of re-asking. `emittedRef` is seeded from persisted.emitted so the
  // "emit EXACTLY ONCE" contract holds across unmount/remount — a restored,
  // already-emitted dialogue re-renders its outcome WITHOUT writing a duplicate.
  const { index, stepKey, answers, recordAnswer, isComplete } = useDialogueState(steps, persisted);
  const [outcome, setOutcome] = useState(null);
  const emittedRef = useRef(Boolean(persisted && persisted.emitted));
  // Option B (inline capture): the built initial event and its server-assigned
  // id are lifted into the persisted snapshot so the Confirm page can emit a
  // SUPERSEDING value-event (afterValue + supersedesId) when the customer
  // saves the corrected value inline. Seeded from the snapshot on remount so
  // navigation never loses the lineage.
  const eventRef = useRef(persisted && persisted.event ? persisted.event : null);
  const eventIdRef = useRef(persisted && persisted.eventId != null ? persisted.eventId : null);
  const [persistTick, setPersistTick] = useState(0);

  useEffect(() => {
    if (!isComplete) return;

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
      // CD-03 EDD (commit 8) — the SAME check and the SAME injectable list the
      // person path uses, now asked of every country-typed company field
      // (registered country, address country, countries of operation, …). Read
      // off the FOUND value: a company already sitting in a high-risk country is
      // what the analyst needs flagged, not only one that corrects into it. The
      // corrected value is checked separately on the superseding event.
      highRiskCountry: fieldHasHighRiskCountry(field),
    });

    // Emit EXACTLY ONCE per completed dialogue — including across a remount: when
    // restored with persisted.emitted, we recompute the outcome to show the
    // notice but skip the write/onEvent so no duplicate change_event is created.
    if (!emittedRef.current) {
      emittedRef.current = true;

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
      // customer (mirrors App.js#trackEvent). writeEvent server-side rejects a
      // malformed/identifier-less event with a 200 + warning, so a missing
      // submissionId can't break the UI.
      eventRef.current = event;
      if (typeof fetch === 'function') {
        fetch('/api/change-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
          .then((r) => r.json())
          .then((d) => {
            // Retain the server-assigned id as the HEAD of this field's event
            // chain, so the first superseding value-event can point at it.
            // Treated as an opaque token (a bigint may arrive as a string).
            // A non-JSON / no-DB / failure response simply leaves it absent —
            // the superseding event is then emitted un-linked, which is the
            // safe path (currency resolves by max id), never an error.
            if (d && d.success && d.id != null) {
              eventIdRef.current = d.id;
              setPersistTick((t) => t + 1);
            } else if (d && d.success === false && d.warning) {
              // api/change-events always answers 200, so a swallowed writeEvent
              // rejection is only observable here — never let it pass silently.
              console.warn('[ChangeDialogue] event rejected:', d.warning);
            }
          })
          .catch((err) => console.warn('[ChangeDialogue] persist failed:', err));
      }

      if (typeof onEvent === 'function') onEvent(event);
    }

    if (typeof onResolved === 'function') onResolved(engineResult);
    setOutcome(engineResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // Lift the working state (answers + progress + emitted + event lineage) into
  // the parent's durable store so it survives the Confirm subtree unmounting on
  // navigation. The parent MERGES this snapshot (it also stashes its own keys —
  // lastSavedValue, chained eventId — on inline save).
  useEffect(() => {
    if (typeof onPersist === 'function') {
      onPersist(field.fieldId, {
        index,
        answers,
        emitted: emittedRef.current,
        event: eventRef.current,
        eventId: eventIdRef.current,
        // The engine result verbatim. The event's column set cannot carry
        // `silent`, so the build-time analyst view (commit 5) reads it from
        // here. Display-only — nothing consumes it for routing.
        outcome,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, answers, outcome, persistTick]);

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
    // NO NOTICE. This used to read "we've added <doc> to your checklist —
    // you'll upload it on the next page", which was true of the old flow and is
    // now wrong twice over: the upload card renders directly beneath this, on
    // THIS page, naming the same document and offering the button. The notice
    // both duplicated it and sent the customer to the wrong place.
    //
    // The requirement itself is unchanged — the event still carries docType,
    // the card still appears, and the submit gate still blocks until it is
    // uploaded. Only the redundant sentence is gone.
    return null;
  }

  // Also NO NOTICE. "We'll review this. No action needed from you right now."
  // belonged to the flow where finishing the dialogue was the end of the
  // interaction. Now the row itself shows the outcome — the corrected value,
  // the "corrected" tag, the upload card when one is owed — so a banner saying
  // nothing is needed is stale reassurance stacked on top of the answer.
  //
  // Every outcome is still recorded and emitted; this only stops rendering a
  // sentence about it.
  return null;
}

export default ChangeDialogue;
