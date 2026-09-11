// jest-dom matchers used by the @testing-library/react render tests.
import "@testing-library/jest-dom";

// doResearch's paid-call confirm guard (App.js) fires whenever demoMode is off
// and the demo toggle is visible — true under jsdom's default "localhost" host.
// Auto-accept by default so the existing real-research characterisation tests
// keep exercising the real path unchanged; a test that wants to assert the
// abort branch overrides with window.confirm.mockReturnValueOnce(false).
//
// This has to be a beforeEach, not a one-time assignment: react-scripts bakes
// in `resetMocks: true` (non-overridable — see createJestConfig.js), which
// wipes every jest.fn()'s implementation back to a bare "returns undefined"
// stub before each test. A one-time `window.confirm = jest.fn(() => true)`
// here would survive exactly zero tests.
beforeEach(() => {
  window.confirm = jest.fn(() => true);
});
