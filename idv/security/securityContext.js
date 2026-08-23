"use strict";

const { IdentityAuthenticationError, IdentityAuthorizationError } = require("../domain/errors");

const PURPOSES = Object.freeze({
  PROVIDER_INGESTION: "PROVIDER_INGESTION",
  CUSTOMER_CONFIRMATION: "CUSTOMER_CONFIRMATION",
  KYC_DECISIONING: "KYC_DECISIONING",
  DATA_SUBJECT_DELETION: "DATA_SUBJECT_DELETION",
  RETENTION_ADMINISTRATION: "RETENTION_ADMINISTRATION",
});

const VERIFIED_CONTEXT = Symbol("VERIFIED_CONTEXT");

class SecurityContext {
  constructor(proof, input) {
    if (proof !== VERIFIED_CONTEXT) throw new IdentityAuthenticationError();
    this.actorId = input.actorId;
    this.tenantId = input.tenantId;
    this.issuer = input.issuer;
    this.audience = Object.freeze([...input.audience]);
    this.roles = Object.freeze([...input.roles]);
    this.scopes = Object.freeze([...input.scopes]);
    this.tokenId = input.tokenId || null;
    this.authenticatedAt = input.authenticatedAt;
    Object.freeze(this);
  }
}

function verifiedSecurityContext(input) {
  for (const field of ["actorId", "tenantId", "issuer", "authenticatedAt"]) {
    if (!input?.[field]) throw new IdentityAuthenticationError(`Verified token omitted ${field}`);
  }
  return new SecurityContext(VERIFIED_CONTEXT, {
    ...input,
    audience: input.audience || [],
    roles: input.roles || [],
    scopes: input.scopes || [],
  });
}

function bindIdentityAccess(securityContext, {
  subjectId,
  purpose,
  fields = [],
  correlationId,
} = {}) {
  if (!(securityContext instanceof SecurityContext)) throw new IdentityAuthenticationError();
  if (!subjectId) throw new IdentityAuthorizationError("Identity access requires a subjectId");
  if (!Object.values(PURPOSES).includes(purpose)) throw new IdentityAuthorizationError("Identity access purpose is invalid");
  if (!correlationId) throw new IdentityAuthorizationError("Identity access requires a correlationId");
  return Object.freeze({
    securityContext,
    tenantId: securityContext.tenantId,
    actorId: securityContext.actorId,
    subjectId,
    purpose,
    fields: Object.freeze([...new Set(fields)]),
    correlationId,
  });
}

const DEFAULT_PURPOSE_POLICY = Object.freeze({
  [PURPOSES.PROVIDER_INGESTION]: { scopes: ["idv:pii:write"] },
  [PURPOSES.CUSTOMER_CONFIRMATION]: { scopes: ["idv:pii:confirm"] },
  [PURPOSES.KYC_DECISIONING]: { scopes: ["idv:pii:read"] },
  [PURPOSES.DATA_SUBJECT_DELETION]: { scopes: ["idv:pii:delete"] },
  [PURPOSES.RETENTION_ADMINISTRATION]: { scopes: ["idv:pii:retention"] },
});

const RESTRICTED_IDENTITY_CONCEPTS = Object.freeze(new Set([
  "document_number",
  "personal_id_number",
  "government_identifier",
]));

class IdentityAccessAuthorizer {
  constructor({ subjectTenantResolver, purposePolicy = DEFAULT_PURPOSE_POLICY } = {}) {
    if (typeof subjectTenantResolver !== "function") throw new TypeError("subjectTenantResolver is required");
    this.resolveSubjectTenant = subjectTenantResolver;
    this.policy = purposePolicy;
  }

  async authorize(access) {
    if (!access?.securityContext || !(access.securityContext instanceof SecurityContext)) {
      throw new IdentityAuthenticationError();
    }
    for (const field of ["tenantId", "actorId", "subjectId", "purpose", "correlationId"]) {
      if (!access[field]) throw new IdentityAuthorizationError(`Identity access requires ${field}`);
    }
    const resolution = await this.resolveSubjectTenant({
      subjectId: access.subjectId,
      tenantId: access.tenantId,
      actorId: access.actorId,
      purpose: access.purpose,
      securityContext: access.securityContext,
    });
    const subjectTenant = typeof resolution === "string" ? resolution : resolution?.tenantId;
    if (!subjectTenant || subjectTenant !== access.tenantId) {
      throw new IdentityAuthorizationError("Subject is not authorized for the authenticated tenant");
    }
    const rule = this.policy[access.purpose];
    if (!rule) throw new IdentityAuthorizationError("Identity access purpose is not authorized");
    const scopes = new Set(access.securityContext.scopes);
    const roles = new Set(access.securityContext.roles);
    const hasScope = (rule.scopes || []).some((scope) => scopes.has(scope));
    const hasRole = (rule.roles || []).some((role) => roles.has(role));
    if (!hasScope && !hasRole) throw new IdentityAuthorizationError("Actor is not authorized for the identity access purpose");
    if (access.fields.some((field) => RESTRICTED_IDENTITY_CONCEPTS.has(field)) && !scopes.has("idv:pii:restricted")) {
      throw new IdentityAuthorizationError("Restricted identity fields require idv:pii:restricted scope");
    }
    return Object.freeze({ ...access, authorized: true });
  }
}

module.exports = {
  PURPOSES,
  SecurityContext,
  // Internal authenticator hook. It is deliberately not re-exported by the
  // public IDV module; HTTP callers can obtain a context only through JWT auth.
  verifiedSecurityContext,
  bindIdentityAccess,
  IdentityAccessAuthorizer,
  DEFAULT_PURPOSE_POLICY,
  RESTRICTED_IDENTITY_CONCEPTS,
};
