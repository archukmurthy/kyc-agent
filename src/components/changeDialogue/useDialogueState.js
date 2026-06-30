/**
 * useDialogueState.js — local, per-instance dialogue state.
 *
 * One hook instance per mounted <ChangeDialogue>. ALL transient working state
 * (which question is showing, the in-progress answers) lives here in component-
 * local useState — it never touches App.js, so answering the dialogue on one
 * unchecked field never re-renders the Confirm table or any other field's
 * dialogue. The only thing that ever crosses the component boundary is the
 * finished event (emitted by ChangeDialogue via onEvent), not this state.
 */

import { useState, useCallback } from 'react';

// `initial` (optional) seeds index/answers from a persisted snapshot so a
// <ChangeDialogue> that re-mounts (e.g. returning to Confirm after navigating
// away) resumes exactly where it left off instead of restarting. Null/absent →
// a fresh dialogue, identical to before.
export function useDialogueState(steps = [], initial = null) {
  const [index, setIndex] = useState(() =>
    initial && Number.isInteger(initial.index) ? initial.index : 0,
  );
  const [answers, setAnswers] = useState(() =>
    initial && initial.answers ? initial.answers : {},
  );

  const recordAnswer = useCallback(
    (key, value) => {
      setAnswers((prev) => ({ ...prev, [key]: value }));
      setIndex((i) => i + 1);
    },
    [],
  );

  const stepKey = index < steps.length ? steps[index] : null;
  const isComplete = index >= steps.length;

  return { index, stepKey, answers, recordAnswer, isComplete };
}
