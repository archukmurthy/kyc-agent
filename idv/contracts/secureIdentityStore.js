"use strict";

const { SecureStoreRequiredError } = require("../domain/errors");

class SecureIdentityStore {
  async persistProviderExtraction() { throw new SecureStoreRequiredError(); }
  async getProviderExtractions() { throw new SecureStoreRequiredError(); }
  async appendCustomerResponse() { throw new SecureStoreRequiredError(); }
  async getCustomerResponses() { throw new SecureStoreRequiredError(); }
  async deleteSubjectIdentityData() { throw new SecureStoreRequiredError(); }
}

class UnavailableSecureIdentityStore extends SecureIdentityStore {}

module.exports = { SecureIdentityStore, UnavailableSecureIdentityStore };
