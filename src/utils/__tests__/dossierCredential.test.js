import {
  setAnalystCredential,
  setCustomerDossierToken,
  clearDossierCredentials,
  getDossierAuthHeaders,
} from "../dossierCredential";

afterEach(() => {
  clearDossierCredentials();
  window.history.pushState({}, "", "/");
});

test("no credential yields only the tenant header", () => {
  expect(getDossierAuthHeaders("acme")).toEqual({ "X-Tenant-Id": "acme" });
});

test("no credential and no tenant yields no headers", () => {
  expect(getDossierAuthHeaders("")).toEqual({});
});

test("an analyst credential becomes a plain bearer", () => {
  setAnalystCredential("analyst-pw");
  expect(getDossierAuthHeaders("acme")).toEqual({ Authorization: "Bearer analyst-pw", "X-Tenant-Id": "acme" });
});

test("a customer token becomes a dossier-prefixed bearer and wins over an analyst credential", () => {
  setAnalystCredential("analyst-pw");
  setCustomerDossierToken("tok");
  expect(getDossierAuthHeaders("acme")).toEqual({ Authorization: "Bearer dossier:tok", "X-Tenant-Id": "acme" });
});

test("the tenant defaults to the URL tenant", () => {
  window.history.pushState({}, "", "/?tenant=acme");
  setAnalystCredential("analyst-pw");
  expect(getDossierAuthHeaders()).toEqual({ Authorization: "Bearer analyst-pw", "X-Tenant-Id": "acme" });
});

test("credentials survive a module-level reload via sessionStorage", () => {
  setAnalystCredential("analyst-pw");
  expect(sessionStorage.getItem("preboarding_token")).toBe("analyst-pw");
});

test("clearing removes both credentials", () => {
  setAnalystCredential("analyst-pw");
  setCustomerDossierToken("tok");
  clearDossierCredentials();
  expect(getDossierAuthHeaders("acme")).toEqual({ "X-Tenant-Id": "acme" });
  expect(sessionStorage.getItem("preboarding_token")).toBeNull();
  expect(sessionStorage.getItem("dossier_token")).toBeNull();
});

// Re-locking the pre-boarding gate (App.js's resetAll, the only place that
// calls setPreboardingUnlocked(false)) must drop the analyst credential too -
// otherwise it sits in sessionStorage after the gate re-locks. resetAll
// guards clearDossierCredentials() on isPreboardingSurface (the `preboarding`
// prop) so a customer's own Start Over never touches their dossier token,
// since clearDossierCredentials() clears both credentials at once.
test("re-locking the pre-boarding gate clears the analyst credential, not a customer's dossier token", () => {
  setAnalystCredential("ARCH");
  const isPreboardingSurface = true; // mirrors resetAll's guard in App.js
  if (isPreboardingSurface) clearDossierCredentials();
  expect(sessionStorage.getItem("preboarding_token")).toBeNull();
});

test("a customer's own Start Over (isPreboardingSurface false) leaves their dossier token in place", () => {
  setCustomerDossierToken("tok");
  const isPreboardingSurface = false; // mirrors resetAll's guard in App.js
  if (isPreboardingSurface) clearDossierCredentials();
  expect(sessionStorage.getItem("dossier_token")).toBe("tok");
});
