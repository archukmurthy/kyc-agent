"use strict";

/** Provider-neutral boundary intended for a later, separate KYC integration. */
class KycIdentityVerificationConsumer {
  async startIdentityVerification() { throw new Error("Not implemented"); }
  async getIdentityVerificationStatus() { throw new Error("Not implemented"); }
  async getVerifiedIdentityResult() { throw new Error("Not implemented"); }
  async recordCustomerIdentityConfirmation() { throw new Error("Not implemented"); }
  async recordCustomerIdentityCorrection() { throw new Error("Not implemented"); }
}

class IdvKycConsumerAdapter extends KycIdentityVerificationConsumer {
  constructor({ idvService }) { super(); this.idv = idvService; }
  async startIdentityVerification(subject, policy) {
    return this.idv.startVerification({
      tenantId: subject.tenantId,
      customerContextId: subject.kycResourceId,
      subjectPersonId: subject.subjectId,
      country: subject.country,
      ...policy,
    });
  }
  async getIdentityVerificationStatus(session, securityContext) {
    return this.idv.getSession(session.internalIdvSessionId, securityContext.tenantId);
  }
  async getVerifiedIdentityResult(session, securityContext) {
    const result = await this.idv.getSession(session.internalIdvSessionId, securityContext.tenantId);
    return result.session.canonical_status === "VERIFIED" ? result : null;
  }
  async recordCustomerIdentityConfirmation(input) { return this.idv.recordCustomerResponse({ ...input, action: "CONFIRMED" }); }
  async recordCustomerIdentityCorrection(input) { return this.idv.recordCustomerResponse({ ...input, action: "CORRECTED" }); }
}

module.exports = { KycIdentityVerificationConsumer, IdvKycConsumerAdapter };
