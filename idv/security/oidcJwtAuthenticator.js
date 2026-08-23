"use strict";

const { createPublicKey, verify, constants } = require("crypto");
const { IdentityAuthenticationError, ConfigurationError } = require("../domain/errors");
const { verifiedSecurityContext } = require("./securityContext");

function decodePart(part, label) {
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); }
  catch (_) { throw new IdentityAuthenticationError(`JWT ${label} is invalid`); }
}

function audienceList(aud) { return Array.isArray(aud) ? aud : (aud ? [aud] : []); }

class OidcJwtAuthenticator {
  constructor({
    issuer,
    audience,
    tenantClaim = "tenant_id",
    rolesClaim = "roles",
    scopesClaim = "scope",
    acceptedAlgorithms = ["RS256"],
    jwksResolver,
    fetchImpl = globalThis.fetch,
    clock = () => new Date(),
    clockToleranceSeconds = 60,
    jwksCacheTtlMs = 5 * 60 * 1000,
  } = {}) {
    if (!issuer || !audience) throw new ConfigurationError("OIDC issuer and audience are required");
    if (!/^https:\/\//i.test(issuer)) throw new ConfigurationError("OIDC issuer must use HTTPS");
    if (!jwksResolver && typeof fetchImpl !== "function") throw new ConfigurationError("OIDC JWKS resolution requires fetch");
    this.issuer = issuer.replace(/\/$/, "");
    this.audience = audience;
    this.tenantClaim = tenantClaim;
    this.rolesClaim = rolesClaim;
    this.scopesClaim = scopesClaim;
    this.acceptedAlgorithms = new Set(acceptedAlgorithms);
    this.jwksResolver = jwksResolver;
    this.fetch = fetchImpl;
    this.clock = clock;
    this.tolerance = clockToleranceSeconds;
    this.jwksCacheTtlMs = jwksCacheTtlMs;
    this.cachedJwks = null;
    this.jwksFetchedAt = 0;
  }

  async resolveJwks(forceRefresh = false) {
    if (this.jwksResolver) return this.jwksResolver();
    if (!forceRefresh && this.cachedJwks && this.clock().valueOf() - this.jwksFetchedAt < this.jwksCacheTtlMs) return this.cachedJwks;
    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    const discoveryResponse = await this.fetch(discoveryUrl, { headers: { accept: "application/json" } });
    if (!discoveryResponse.ok) throw new IdentityAuthenticationError("OIDC discovery failed");
    const discovery = await discoveryResponse.json();
    if (discovery.issuer !== this.issuer || !/^https:\/\//i.test(discovery.jwks_uri || "")) {
      throw new IdentityAuthenticationError("OIDC discovery metadata is not trusted");
    }
    const jwksResponse = await this.fetch(discovery.jwks_uri, { headers: { accept: "application/json" } });
    if (!jwksResponse.ok) throw new IdentityAuthenticationError("OIDC JWKS retrieval failed");
    const jwks = await jwksResponse.json();
    if (!Array.isArray(jwks.keys)) throw new IdentityAuthenticationError("OIDC JWKS is invalid");
    this.cachedJwks = jwks;
    this.jwksFetchedAt = this.clock().valueOf();
    return jwks;
  }

  verifySignature(algorithm, publicKey, signingInput, signature) {
    const data = Buffer.from(signingInput, "ascii");
    const signatureBuffer = Buffer.from(signature, "base64url");
    if (algorithm === "RS256") return verify("RSA-SHA256", data, publicKey, signatureBuffer);
    if (algorithm === "PS256") {
      return verify("RSA-SHA256", data, {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      }, signatureBuffer);
    }
    if (algorithm === "ES256") {
      return verify("SHA256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signatureBuffer);
    }
    return false;
  }

  async authenticate(authorizationHeader) {
    const match = /^Bearer\s+([^\s]+)$/i.exec(String(authorizationHeader || ""));
    if (!match) throw new IdentityAuthenticationError("Bearer token is required");
    const parts = match[1].split(".");
    if (parts.length !== 3) throw new IdentityAuthenticationError("JWT structure is invalid");
    const header = decodePart(parts[0], "header");
    const claims = decodePart(parts[1], "payload");
    if (!header.kid || !this.acceptedAlgorithms.has(header.alg) || header.typ && header.typ !== "JWT") {
      throw new IdentityAuthenticationError("JWT signing metadata is not accepted");
    }
    let jwks = await this.resolveJwks();
    let jwk = jwks.keys.find((item) => item.kid === header.kid && (!item.alg || item.alg === header.alg) && (!item.use || item.use === "sig"));
    if (!jwk && !this.jwksResolver) {
      jwks = await this.resolveJwks(true);
      jwk = jwks.keys.find((item) => item.kid === header.kid && (!item.alg || item.alg === header.alg) && (!item.use || item.use === "sig"));
    }
    if (!jwk) throw new IdentityAuthenticationError("JWT signing key is unavailable");
    let publicKey;
    try { publicKey = createPublicKey({ key: jwk, format: "jwk" }); }
    catch (_) { throw new IdentityAuthenticationError("JWT signing key is invalid"); }
    if (!this.verifySignature(header.alg, publicKey, `${parts[0]}.${parts[1]}`, parts[2])) {
      throw new IdentityAuthenticationError("JWT signature is invalid");
    }
    const now = Math.floor(this.clock().valueOf() / 1000);
    if (claims.iss !== this.issuer) throw new IdentityAuthenticationError("JWT issuer is invalid");
    if (!audienceList(claims.aud).includes(this.audience)) throw new IdentityAuthenticationError("JWT audience is invalid");
    if (!Number.isFinite(claims.exp) || now - this.tolerance >= claims.exp) throw new IdentityAuthenticationError("JWT is expired");
    if (claims.nbf != null && (!Number.isFinite(claims.nbf) || now + this.tolerance < claims.nbf)) throw new IdentityAuthenticationError("JWT is not active");
    if (claims.iat != null && (!Number.isFinite(claims.iat) || claims.iat > now + this.tolerance)) throw new IdentityAuthenticationError("JWT issued-at is invalid");
    if (!claims.sub || !claims[this.tenantClaim]) throw new IdentityAuthenticationError("JWT subject or signed tenant claim is missing");
    const rolesValue = claims[this.rolesClaim];
    const scopesValue = claims[this.scopesClaim];
    const roles = Array.isArray(rolesValue) ? rolesValue : (rolesValue ? [rolesValue] : []);
    const scopes = Array.isArray(scopesValue) ? scopesValue : String(scopesValue || "").split(/\s+/).filter(Boolean);
    return verifiedSecurityContext({
      actorId: claims.sub,
      tenantId: claims[this.tenantClaim],
      issuer: claims.iss,
      audience: audienceList(claims.aud),
      roles,
      scopes,
      tokenId: claims.jti || null,
      authenticatedAt: this.clock().toISOString(),
    });
  }
}

module.exports = { OidcJwtAuthenticator };
