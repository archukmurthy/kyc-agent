"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, randomBytes } = require("crypto");
const { LocalTestManagedKeyProvider, requireProductionManagedKeyProvider } = require("../security/managedKeyProvider");
const { EnvelopeEncryption } = require("../security/envelopeEncryption");
const { OidcJwtAuthenticator } = require("../security/oidcJwtAuthenticator");
const { IdentityAccessAuthorizer, PURPOSES, bindIdentityAccess } = require("../security/securityContext");
const { PostgresSecureIdentityStore } = require("../stores/postgresSecureIdentityStore");
const { createIdentityAttribute } = require("../domain/canonical");

function jwt(privateKey, claims, { kid = "test-kid", alg = "RS256" } = {}) {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

test("OIDC JWT authentication validates signature, issuer, audience, expiry, and signed tenant claim", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const nowSeconds = Date.parse("2030-01-01T00:00:00Z") / 1000;
  const authenticator = new OidcJwtAuthenticator({
    issuer: "https://issuer.example",
    audience: "idv-api",
    tenantClaim: "org_id",
    jwksResolver: async () => ({ keys: [{ ...jwk, kid: "test-kid", alg: "RS256", use: "sig" }] }),
    clock: () => new Date("2030-01-01T00:00:00Z"),
  });
  const token = jwt(privateKey, { iss: "https://issuer.example", aud: "idv-api", sub: "actor-1", org_id: "tenant-a", scope: "idv:pii:read idv:pii:restricted", iat: nowSeconds, exp: nowSeconds + 300 });
  const context = await authenticator.authenticate(`Bearer ${token}`);
  assert.equal(context.actorId, "actor-1");
  assert.equal(context.tenantId, "tenant-a");
  assert.deepEqual(context.scopes, ["idv:pii:read", "idv:pii:restricted"]);
  const badKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const bad = jwt(badKey, { iss: "https://issuer.example", aud: "idv-api", sub: "actor-1", org_id: "tenant-a", exp: nowSeconds + 300 });
  await assert.rejects(authenticator.authenticate(`Bearer ${bad}`), /signature/);
  const expired = jwt(privateKey, { iss: "https://issuer.example", aud: "idv-api", sub: "actor-1", org_id: "tenant-a", exp: nowSeconds - 61 });
  await assert.rejects(authenticator.authenticate(`Bearer ${expired}`), /expired/);
});

test("local test key provider is explicit, randomized, authenticated, and forbidden in production", async () => {
  assert.throws(() => new LocalTestManagedKeyProvider({ wrappingKey: randomBytes(32), runtimeMode: "production" }), /forbidden/);
  const keys = new LocalTestManagedKeyProvider({ wrappingKey: randomBytes(32), runtimeMode: "test" });
  assert.throws(() => requireProductionManagedKeyProvider(keys), /approved production/);
  const crypto = new EnvelopeEncryption({ managedKeyProvider: keys });
  const aad = { tenant_id: "tenant-a", subject_id: "subject-a", item_id: "item-a" };
  const first = await crypto.encryptJson({ first_name: "SYNTHETIC_NAME" }, aad);
  const second = await crypto.encryptJson({ first_name: "SYNTHETIC_NAME" }, aad);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await crypto.decryptJson(first, aad), { first_name: "SYNTHETIC_NAME" });
  await assert.rejects(crypto.decryptJson({ ...first, authentication_tag: Buffer.alloc(16).toString("base64") }, aad));
  await assert.rejects(crypto.decryptJson(first, { ...aad, tenant_id: "tenant-b" }));
});

test("purpose authorization blocks cross-tenant subjects and restricted fields without scope", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const now = 1893456000;
  const authn = new OidcJwtAuthenticator({ issuer: "https://issuer.example", audience: "idv-api", jwksResolver: async () => ({ keys: [{ ...jwk, kid: "k", alg: "RS256" }] }), clock: () => new Date(now * 1000) });
  const context = await authn.authenticate(`Bearer ${jwt(privateKey, { iss: "https://issuer.example", aud: "idv-api", sub: "actor", tenant_id: "tenant-a", scope: "idv:pii:read", exp: now + 300 }, { kid: "k" })}`);
  const authorizer = new IdentityAccessAuthorizer({ subjectTenantResolver: async ({ subjectId }) => subjectId === "subject-a" ? "tenant-a" : "tenant-b" });
  await assert.rejects(authorizer.authorize(bindIdentityAccess(context, { subjectId: "subject-b", purpose: PURPOSES.KYC_DECISIONING, fields: ["first_name"], correlationId: "c1" })), /authenticated tenant/);
  await assert.rejects(authorizer.authorize(bindIdentityAccess(context, { subjectId: "subject-a", purpose: PURPOSES.KYC_DECISIONING, fields: ["document_number"], correlationId: "c2" })), /restricted/);
});

test("Postgres secure store binds ciphertext to tenant/subject and never sends PII plaintext to SQL", async () => {
  const sqlCalls = [];
  let identityReference;
  let encryptedRow;
  const client = { query: async (sql, params = []) => {
    sqlCalls.push({ sql, params });
    if (sql.includes("SELECT identity_reference, subject_id, deletion_status")) return { rows: [] };
    if (sql.includes("INSERT INTO idv_secure_identity_records")) { identityReference = params[0]; return { rows: [] }; }
    if (sql.includes("SELECT identity_reference, subject_id FROM")) return { rows: [{ identity_reference: identityReference, subject_id: "subject-a" }] };
    if (sql.includes("INSERT INTO idv_encrypted_identity_attributes")) {
      encryptedRow = {
        identity_reference: params[0], tenant_id: params[1], subject_id: params[2], attribute_id: params[3], attribute_concept: params[4],
        envelope_version: params[6], encryption_algorithm: params[7], ciphertext: params[8], nonce: params[9], authentication_tag: params[10],
        wrapped_dek: JSON.parse(params[11]), kms_provider: params[12], kms_key_id: params[13], kms_key_version: params[14],
      };
      return { rows: [] };
    }
    if (sql.includes("SELECT identity_reference FROM idv_secure_identity_records")) return { rows: [{ identity_reference: identityReference }] };
    if (sql.includes("SELECT * FROM idv_encrypted_identity_attributes")) return { rows: [encryptedRow] };
    return { rows: [] };
  } };
  const runner = { withTenantTransaction: async (tenantId, work) => { assert.equal(tenantId, "tenant-a"); return work(client); } };
  const keys = new LocalTestManagedKeyProvider({ wrappingKey: randomBytes(32) });
  const access = {
    synthetic: false, tenantId: "tenant-a", actorId: "actor", subjectId: "subject-a", purpose: PURPOSES.PROVIDER_INGESTION,
    fields: ["first_name"], correlationId: "corr", securityContext: Object.create(null),
  };
  // The real authorizer requires an authenticated SecurityContext. Keep this
  // store-focused test explicit by authorizing a frozen trusted test decision.
  const store = new PostgresSecureIdentityStore({
    transactionRunner: runner,
    envelopeEncryption: new EnvelopeEncryption({ managedKeyProvider: keys }),
    authorizer: { authorize: async (candidate) => Object.freeze({ ...candidate, authorized: true }) },
  });
  const attribute = createIdentityAttribute({ concept: "first_name", value: "SYNTHETIC_NAME_001", provider: "TEST", providerSessionId: "provider-session", stableOrdinal: 0 });
  const stored = await store.storeExtractedIdentity({ internalIdvSessionId: "11111111-1111-4111-8111-111111111111", attributes: [attribute], access });
  assert.equal(stored.secureIdentityReference, identityReference);
  assert.equal(JSON.stringify(sqlCalls).includes("SYNTHETIC_NAME_001"), false);
  const readAccess = { ...access, purpose: PURPOSES.KYC_DECISIONING };
  const retrieved = await store.retrieveIdentityForAuthorizedPurpose({ identityReference, access: readAccess, fields: ["first_name"] });
  assert.equal(retrieved.attributes[0].attribute_value, "SYNTHETIC_NAME_001");
});

test("the public module does not expose a context-forging factory", () => {
  assert.equal(require("..").verifiedSecurityContext, undefined);
});
