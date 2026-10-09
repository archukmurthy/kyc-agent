// jest-dom matchers used by the @testing-library/react render tests.
import "@testing-library/jest-dom";

// doResearch's paid-call confirm guard (App.js) fires whenever demoMode is off
// and the demo toggle is visible - true under jsdom's default "localhost" host.
// Auto-accept by default so the existing real-research characterisation tests
// keep exercising the real path unchanged; a test that wants to assert the
// abort branch overrides with window.confirm.mockReturnValueOnce(false).
//
// This has to be a beforeEach, not a one-time assignment: react-scripts bakes
// in `resetMocks: true` (non-overridable - see createJestConfig.js), which
// wipes every jest.fn()'s implementation back to a bare "returns undefined"
// stub before each test. A one-time `window.confirm = jest.fn(() => true)`
// here would survive exactly zero tests.
beforeEach(() => {
  window.confirm = jest.fn(() => true);
});

// The app is tenant-scoped and "3-strict": src/utils/tenant.js#getTenantId()
// resolves ONLY from ?tenant= in the URL, with no default tenant. jsdom's
// default test URL is "http://localhost/" (no query string), which reads as
// "no tenant selected" and renders NoTenantLanding - not the flow that
// hundreds of existing render tests drive. Give every test a tenant by
// default so they keep reaching the real app; a test that wants a different
// URL (a different tenant, a path, ?preboarding=1, or the no-tenant landing
// itself) calls history.pushState in its OWN beforeEach/test, which runs
// after this one and wins.
beforeEach(() => {
  window.history.pushState({}, "", "/?tenant=nium");
});
