const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { readConfigForTenant } = require("../config");

// Reset the module-level `_deps` seam after every test so a store/sendEmail
// fake wired by one test (e.g. the custom sendEmail below) can never leak
// into a later test that doesn't expect it — tests must be order-independent.
afterEach(() => {
  const handler = require("../invite");
  handler.__setDeps({
    store: fakeStore(),
    sendEmail: async () => {
      throw new Error("sendEmail called without a test-provided fake");
    },
    readConfigForTenant,
  });
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

function fakeStore() {
  const data = {};
  return {
    data,
    async set(key, value) { data[key] = value; },
  };
}

const basePayload = {
  email: "sarah@company.com",
  contactName: "Sarah Chen",
  companyName: "Acme Ltd",
  origin: "https://kyc-agent-deploy.vercel.app",
  dossierId: "dossier-1",
  tenantId: "nium",
};

function reqWith(body, headers) {
  return {
    method: "POST",
    body,
    headers: headers || { host: "kyc-agent-deploy.vercel.app" },
  };
}

test("400 when email or contactName is missing", async () => {
  const handler = require("../invite");
  const res = fakeRes();
  await handler(reqWith({ dossierId: "d1", tenantId: "nium" }), res);
  assert.strictEqual(res.statusCode, 400);
});

test("400 when dossierId is missing — no working link can be produced", async () => {
  const handler = require("../invite");
  const res = fakeRes();
  await handler(
    reqWith({ email: "a@b.com", contactName: "A B", tenantId: "nium" }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /dossierId/i);
});

test("simulate path (no RESEND_API_KEY): email carries dossierId link, not ?ref=", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    await handler(reqWith({ ...basePayload }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.simulated, true);
    assert.match(res.body.link, /dossierId=dossier-1/);
    assert.doesNotMatch(res.body.link, /\?ref=/);

    // Persisted record carries dossierId for future server-side resolution.
    const stored = store.data[`invite:${res.body.token}`];
    assert.ok(stored, "invite record should be persisted");
    assert.strictEqual(stored.dossierId, "dossier-1");
    assert.strictEqual(stored.tenantId, "nium");
    assert.match(stored.link, /dossierId=dossier-1/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("email body/link never contains ?ref= and always contains dossierId=", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-key";
  const store = fakeStore();
  let sentArgs = null;
  handler.__setDeps({
    store,
    sendEmail: async (args) => {
      sentArgs = args;
      return { ok: true, data: { id: "provider-id-1" } };
    },
  });
  try {
    const res = fakeRes();
    await handler(reqWith({ ...basePayload }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.sent, true);
    assert.ok(sentArgs, "sendEmail should have been called");
    assert.match(sentArgs.text, /dossierId=dossier-1/);
    assert.doesNotMatch(sentArgs.text, /\?ref=/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("same-origin validation rejects a foreign-origin client link and falls back to the server-reconstructed one", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    await handler(
      reqWith(
        {
          ...basePayload,
          // Attacker-controlled: absolute URL on a different host, carrying the
          // right dossierId so only the origin check can catch it.
          link: "https://evil.example.com/?tenant=nium&dossierId=dossier-1&journey=customer",
        },
        { host: "kyc-agent-deploy.vercel.app" }
      ),
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.doesNotMatch(res.body.link, /evil\.example\.com/);
    assert.match(res.body.link, /^https:\/\/kyc-agent-deploy\.vercel\.app\//);
    assert.match(res.body.link, /dossierId=dossier-1/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("valid same-origin client link (matching dossierId) is used as-is", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    const clientLink =
      "https://kyc-agent-deploy.vercel.app/?tenant=nium&dossierId=dossier-1&journey=customer&extra=1";
    await handler(
      reqWith({ ...basePayload, link: clientLink }, { host: "kyc-agent-deploy.vercel.app" }),
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.link, clientLink);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("client-supplied link with a mismatched dossierId is rejected even when same-origin", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    await handler(
      reqWith(
        {
          ...basePayload,
          link: "https://kyc-agent-deploy.vercel.app/?tenant=nium&dossierId=some-other-dossier&journey=customer",
        },
        { host: "kyc-agent-deploy.vercel.app" }
      ),
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.link, /dossierId=dossier-1/);
    assert.doesNotMatch(res.body.link, /some-other-dossier/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("client-supplied link whose dossierId is a prefix-superstring of the real one is rejected (exact match, not substring)", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    await handler(
      reqWith(
        {
          ...basePayload,
          // "dossier-1" is a prefix of "dossier-1337..." — an unanchored
          // `includes()` check would wrongly accept this as a match.
          link: "https://kyc-agent-deploy.vercel.app/?tenant=nium&dossierId=dossier-1337-evil&journey=customer",
        },
        { host: "kyc-agent-deploy.vercel.app" }
      ),
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.link, /^https:\/\/kyc-agent-deploy\.vercel\.app\//);
    assert.match(res.body.link, /dossierId=dossier-1(&|$)/);
    assert.doesNotMatch(res.body.link, /dossier-1337-evil/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("client-supplied link with a mismatched tenant is rejected even when same-origin and dossierId matches", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    await handler(
      reqWith(
        {
          ...basePayload,
          link: "https://kyc-agent-deploy.vercel.app/?tenant=other-tenant&dossierId=dossier-1&journey=customer",
        },
        { host: "kyc-agent-deploy.vercel.app" }
      ),
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.link, /tenant=nium/);
    assert.doesNotMatch(res.body.link, /other-tenant/);
    assert.match(res.body.link, /dossierId=dossier-1(&|$)/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("malformed (non-URL) client-supplied link does not throw and is rejected", async () => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({ store });
  try {
    const res = fakeRes();
    await handler(
      reqWith(
        { ...basePayload, link: "not a url at all :: dossierId=dossier-1" },
        { host: "kyc-agent-deploy.vercel.app" }
      ),
      res
    );

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.link, /^https:\/\/kyc-agent-deploy\.vercel\.app\//);
    assert.match(res.body.link, /tenant=nium/);
    assert.match(res.body.link, /dossierId=dossier-1(&|$)/);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("the email uses the tenant's own company name, not a hardcoded brand", async (t) => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({
    store,
    readConfigForTenant: async () => ({ company: { name: "Acme Payments" } }),
  });
  try {
    const res = fakeRes();
    await handler(reqWith({ ...basePayload, tenantId: "acme" }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.subject, /Acme Payments/);
    assert.doesNotMatch(res.body.subject, /Nium/i);
    assert.doesNotMatch(res.body.body, /Nium/i);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("a tenant with no configured company name falls back to its tenant id", async (t) => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  handler.__setDeps({ store: fakeStore(), readConfigForTenant: async () => ({ company: {} }) });
  try {
    const res = fakeRes();
    await handler(reqWith({ ...basePayload, tenantId: "acme" }), res);
    assert.match(res.body.subject, /acme/);
    assert.doesNotMatch(res.body.subject, /Nium/i);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});
