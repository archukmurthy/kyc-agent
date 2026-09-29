import { sanitiseTenantId, getTenantId, tenantUrl } from "../tenant";

// 3-strict tenant resolution: there is no default tenant anywhere in this
// module. Absence of ?tenant= (or an empty/invalid value) must resolve to
// "" so callers (App.js) can render the "no tenant selected" landing instead
// of silently defaulting to any one customer.

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("sanitiseTenantId", () => {
  it("lowercases, strips invalid chars, and clamps to 32 chars", () => {
    expect(sanitiseTenantId("Acme-Corp_1!")).toBe("acme-corp1");
    expect(sanitiseTenantId("a".repeat(40))).toBe("a".repeat(32));
  });

  it("returns '' for empty/nullish input - no fallback tenant", () => {
    expect(sanitiseTenantId("")).toBe("");
    expect(sanitiseTenantId(null)).toBe("");
    expect(sanitiseTenantId(undefined)).toBe("");
    expect(sanitiseTenantId("!!!")).toBe(""); // sanitises to empty
  });
});

describe("getTenantId", () => {
  it("resolves 'acme' from ?tenant=acme", () => {
    window.history.pushState({}, "", "/?tenant=acme");
    expect(getTenantId()).toBe("acme");
  });

  it("returns '' with no ?tenant= param - no default tenant", () => {
    window.history.pushState({}, "", "/");
    expect(getTenantId()).toBe("");
  });

  it("returns '' for a ?tenant= param that sanitises to empty", () => {
    window.history.pushState({}, "", "/?tenant=!!!");
    expect(getTenantId()).toBe("");
  });
});

describe("tenantUrl", () => {
  it("appends ?tenant= for a non-empty tenant id", () => {
    expect(tenantUrl("/admin", "acme")).toBe("/admin?tenant=acme");
  });

  it("uses & when the path already has a query string", () => {
    expect(tenantUrl("/admin?x=1", "acme")).toBe("/admin?x=1&tenant=acme");
  });

  it("leaves the path unchanged for an empty tenant id - nothing to omit a default for", () => {
    expect(tenantUrl("/admin", "")).toBe("/admin");
    expect(tenantUrl("/admin", null)).toBe("/admin");
  });
});
