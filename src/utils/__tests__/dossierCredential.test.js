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
