/**
 * The silence-later guarantee, asserted directly: with the test-tools flag off,
 * commit 5's analyst UI renders NOTHING. This is the check that lets us ship
 * the build-time view knowing one flag removes it for real customers.
 *
 * react-dom + act (this repo does not install @testing-library) — same pattern
 * as src/__tests__/appMounts.test.jsx.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import AnalystSignalStrip from '../AnalystSignalStrip';
import { buildAnalystSignal } from '../analystSignals';

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

const type1 = buildAnalystSignal({
  event: {
    fieldClass: 'address',
    beforeValue: '123 Sample Street',
    workflow: 'doc_required',
    docType: 'Notice of Change of Address',
    matchedRule: 'ADDR-NOTREFLECTED',
    decided: true,
  },
  correctedValue: '1 New Street',
});

const type2 = buildAnalystSignal({
  event: {
    fieldClass: 'generic',
    beforeValue: 'ACME Holdings',
    workflow: 'ops_review',
    docType: null,
    matchedRule: 'GENERIC',
    decided: true,
  },
});

const render = async (el) => { await act(async () => { root.render(el); }); };

// Guards the resolution trap this component was renamed to avoid: `.js` is
// tried before `.jsx`, so on a case-insensitive filesystem a component named
// AnalystSignals.jsx would silently resolve to the analystSignals.js helper and
// render as null. If those two names ever collide again, this fails loudly.
test('the component import resolves to a real component, not the helper module', () => {
  expect(typeof AnalystSignalStrip).toBe('function');
  expect(AnalystSignalStrip({ show: true, signal: type1 })).not.toBeNull();
});

describe('AnalystSignalStrip — silence-later', () => {
  it('renders NOTHING when the test-tools flag is off (type 1)', async () => {
    await render(<AnalystSignalStrip show={false} signal={type1} fieldId="addressLine1" />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('[data-testid="analyst-signals"]')).toBeNull();
  });

  it('renders NOTHING when the test-tools flag is off (type 2 placeholder)', async () => {
    await render(<AnalystSignalStrip show={false} signal={type2} fieldId="tradeName" />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('[data-testid="analyst-signals"]')).toBeNull();
  });

  it('defaults to hidden when `show` is not passed at all', async () => {
    await render(<AnalystSignalStrip signal={type1} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when there is no recorded signal, flag on or off', async () => {
    await render(<AnalystSignalStrip show signal={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('AnalystSignalStrip — visible now', () => {
  it('shows the registry mismatch, document and rule for a type-1 outcome', async () => {
    await render(<AnalystSignalStrip show signal={type1} fieldId="addressLine1" />);
    const text = container.textContent;
    expect(container.querySelector('[data-testid="analyst-signals"]')).not.toBeNull();
    expect(text).toContain('Customer value differs from registry');
    expect(text).toContain('Notice of Change of Address');
    expect(text).toContain('ADDR-NOTREFLECTED');
    // Unmistakably a build-time aid, never customer UI.
    expect(text).toContain('test view');
    expect(text).toContain('not shown to customers');
  });

  it('shows the explicit no-consequence placeholder for a type-2 field class', async () => {
    await render(<AnalystSignalStrip show signal={type2} fieldId="tradeName" />);
    const text = container.textContent;
    expect(text).toContain('No automated consequence for this field class');
    expect(text).toContain('generic');
    expect(text).toContain('ops_review');
    expect(text).toContain('no engine consequence');
  });
});
