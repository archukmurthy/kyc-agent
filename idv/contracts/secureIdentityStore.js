"use strict";

const { SecureStoreRequiredError } = require("../domain/errors");

class SecureIdentityStore {
  async storeExtractedIdentity() { throw new SecureStoreRequiredError(); }
  async retrieveIdentityForAuthorizedPurpose() { throw new SecureStoreRequiredError(); }
  async recordCustomerConfirmation() { throw new SecureStoreRequiredError(); }
  async recordCustomerCorrection() { throw new SecureStoreRequiredError(); }
  async recordCustomerRejection() { throw new SecureStoreRequiredError(); }
  async deleteOrScheduleDeletion() { throw new SecureStoreRequiredError(); }
  async getRetentionMetadata() { throw new SecureStoreRequiredError(); }
}

class UnavailableSecureIdentityStore extends SecureIdentityStore {}

module.exports = { SecureIdentityStore, UnavailableSecureIdentityStore };
