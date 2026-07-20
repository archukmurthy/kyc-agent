/**
 * appMounts.test.jsx — characterization safety net for the modular refactor.
 * Mounts the full KYCAgent tree with react-dom + act (no @testing-library —
 * this repo does not install it) and asserts the landing page renders. Any
 * extraction that breaks an import, a hook order, or top-level module init
 * fails this test immediately.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import KYCAgent from '../App';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  // /api/config, track-event and ipify all fire on mount — stub fetch so the
  // component falls back to buildLocalDefaultConfig() deterministically.
  global.fetch = jest.fn(() => Promise.reject(new Error('offline test')));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

test('KYCAgent mounts and renders the landing/journey surface', async () => {
  await act(async () => {
    root.render(<KYCAgent />);
  });
  // Landing page (agent selection) is the first surface; it must contain
  // real text, proving the whole module graph evaluated without throwing.
  expect(container.textContent.length).toBeGreaterThan(0);
});
