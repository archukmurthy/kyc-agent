/**
 * ChangeDialogue.test.jsx — drives the component with react-dom + act (no
 * @testing-library dependency, which this repo does not install).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ChangeDialogue } from '../ChangeDialogue';

// React 18 concurrent act() needs this flag set before rendering.
global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui) {
  act(() => {
    root.render(ui);
  });
}

function clickByText(text) {
  const btn = [...container.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === text,
  );
  if (!btn) throw new Error(`button "${text}" not found; have: ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const question = () => container.querySelector('[data-testid="change-dialogue-question"]');
const notice = () => container.querySelector('[data-testid="change-dialogue-notice"]');

describe('ChangeDialogue — question flow + single emit', () => {
  test('ubo (structured registry): intent → registry → ONE event, doc notice', () => {
    const onEvent = jest.fn();
    render(
      <ChangeDialogue
        field={{ fieldId: 'ubo.0.share_percentage', value: '25%', sourceTier: 'tier1' }}
        jurisdiction="GB"
        submissionId="sub-1"
        dossierId="dos-1"
        onEvent={onEvent}
      />,
    );

    // Q1 intent
    expect(question()).toBeTruthy();
    clickByText('Telling you about a change'); // genuine_update -> engine 'update'
    // Q2 registry
    expect(question()).toBeTruthy();
    clickByText('Not yet'); // not_reflected

    // Finalised: exactly one event, doc_required notice (UBO has an update rule).
    expect(onEvent).toHaveBeenCalledTimes(1);
    const event = onEvent.mock.calls[0][0];
    expect(event.fieldClass).toBe('ubo');
    expect(event.customerIntent).toBe('genuine_update');
    expect(event.customerRegistryClaim).toBe('not_reflected');
    expect(event.workflow).toBe('doc_required');
    expect(notice().textContent).toMatch(/Updated UBO Registry/);
  });

  test('factualId: no questions → immediate single event + doc notice', () => {
    const onEvent = jest.fn();
    render(
      <ChangeDialogue
        field={{ fieldId: 'company_registration_number', value: '12345678', sourceTier: 'tier1' }}
        onEvent={onEvent}
      />,
    );
    expect(question()).toBeNull();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].fieldClass).toBe('factualId');
    expect(notice()).toBeTruthy();
  });

  test('generic field: neutral notice, ops_review, one event', () => {
    const onEvent = jest.fn();
    render(
      <ChangeDialogue field={{ fieldId: 'annual_revenue', value: '1m', sourceTier: 'tier1' }} onEvent={onEvent} />,
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].workflow).toBe('ops_review');
    expect(notice().textContent).toMatch(/review this/i);
  });
});

describe('ChangeDialogue — UNDECIDED and escalation both render neutral', () => {
  test('UNDECIDED (director genuine_update "changed" has no rule) → neutral, decided:false', () => {
    const onEvent = jest.fn();
    render(
      <ChangeDialogue field={{ fieldId: 'director.0', value: 'Jane', sourceTier: 'tier1' }} onEvent={onEvent} />,
    );
    clickByText('Telling you about a change'); // genuine_update -> engine changeType 'update'
    clickByText('Not yet'); // not_reflected (director has no update rule -> UNDECIDED)

    const event = onEvent.mock.calls[0][0];
    expect(event.workflow).toBe('UNDECIDED');
    expect(event.decided).toBe(false);
    // Neutral treatment, no error, no doc.
    expect(notice().textContent).toMatch(/review this/i);
    expect(notice().textContent).not.toMatch(/UNDECIDED|error/i);
  });

  test('escalation (PEP) renders identically to ops_review — never revealed', () => {
    const onEvent = jest.fn();
    render(<ChangeDialogue field={{ fieldId: 'is_pep', value: 'No', sourceTier: 'tier1' }} onEvent={onEvent} />);

    expect(question()).toBeNull(); // PEP asks nothing
    const event = onEvent.mock.calls[0][0];
    expect(event.workflow).toBe('escalation');
    expect(event.escalation).toBe(true);
    // The customer must NOT see the word escalation or the reason.
    expect(notice().textContent).toMatch(/review this/i);
    expect(notice().textContent).not.toMatch(/escalat/i);
  });
});

describe('ChangeDialogue — verifiability fallback skips the registry question', () => {
  test('non-structured director asks intent only, then routes via the engine', () => {
    const onEvent = jest.fn();
    render(
      <ChangeDialogue
        field={{ fieldId: 'director.0', value: 'Jane', sourceTier: 'tier2' }} // unverified
        onEvent={onEvent}
      />,
    );
    // Only the intent question — registry is skipped (no structured registry).
    expect(question()).toBeTruthy();
    expect(question().textContent).toMatch(/correcting/i);
    clickByText('Correcting what you found'); // ai_correction

    // No second (registry) question — it finalised straight to a notice.
    expect(question()).toBeNull();
    expect(notice()).toBeTruthy();
    expect(onEvent).toHaveBeenCalledTimes(1);
    const event = onEvent.mock.calls[0][0];
    expect(event.verifiability).toBe('unverified');
    expect(event.customerRegistryClaim).toBe('unknown'); // never asked
    expect(event.workflow).toBe('analyst_review'); // engine guard, not the component
  });
});

describe('ChangeDialogue — boundary: write-only, no Fill-Gaps coupling', () => {
  const componentSrc = fs.readFileSync(
    path.join(__dirname, '..', 'ChangeDialogue.jsx'),
    'utf8',
  );

  test('imports nothing from Fill Gaps and exposes no Fill-Gaps-mutating prop', () => {
    // No import line references Fill Gaps / gap state.
    const importLines = componentSrc.split('\n').filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(/fill[\s-]?gaps|gapRef|gapFields|setGap|FillGaps/i);
    }
    // The destructured prop surface contains only the contract props — no
    // onInjectDoc / onAddGap / setFillGaps style mutators.
    expect(componentSrc).not.toMatch(/onInjectDoc|onAddGap|setFillGaps|mutateGap|injectDocument/i);
  });

  test('the only outbound channel is onEvent / onResolved', () => {
    // Sanity: the component calls onEvent (the single emit) and onResolved.
    expect(componentSrc).toMatch(/onEvent\(/);
    expect(componentSrc).toMatch(/onResolved\(/);
  });
});
