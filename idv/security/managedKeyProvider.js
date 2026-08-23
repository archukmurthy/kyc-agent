"use strict";

const { randomBytes, createCipheriv, createDecipheriv } = require("crypto");
const { ManagedKeyRequiredError, ConfigurationError } = require("../domain/errors");

const WRAP_ALGORITHM = "AES-256-GCM";

class ManagedKeyProvider {
  constructor({ providerId, productionReady = false } = {}) {
    this.providerId = providerId || "UNAVAILABLE";
    this.productionReady = productionReady === true;
  }

  async wrapKey() { throw new ManagedKeyRequiredError(); }
  async unwrapKey() { throw new ManagedKeyRequiredError(); }
  getActiveKeyMetadata() { throw new ManagedKeyRequiredError(); }
}

class UnavailableManagedKeyProvider extends ManagedKeyProvider {}

/**
 * Explicitly test-only key wrapper. It never reads an environment variable and
 * refuses to initialize in production. Production must inject an approved KMS
 * or key-vault-backed ManagedKeyProvider implementation.
 */
class LocalTestManagedKeyProvider extends ManagedKeyProvider {
  constructor({ wrappingKey, keyId = "local-test-key", keyVersion = "1", runtimeMode = "test" } = {}) {
    if (runtimeMode === "production") {
      throw new ManagedKeyRequiredError("The local test key provider is forbidden in production");
    }
    if (!Buffer.isBuffer(wrappingKey) || wrappingKey.length !== 32) {
      throw new ConfigurationError("LocalTestManagedKeyProvider requires a 32-byte in-memory test key");
    }
    super({ providerId: "LOCAL_TEST_ONLY", productionReady: false });
    this.wrappingKey = Buffer.from(wrappingKey);
    this.keyId = keyId;
    this.keyVersion = keyVersion;
  }

  getActiveKeyMetadata() {
    return { provider_id: this.providerId, key_id: this.keyId, key_version: this.keyVersion };
  }

  async wrapKey(plaintextKey, { aad } = {}) {
    if (!Buffer.isBuffer(plaintextKey) || plaintextKey.length !== 32) throw new TypeError("DEK must be a 32-byte Buffer");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.wrappingKey, nonce);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    return {
      provider_id: this.providerId,
      algorithm: WRAP_ALGORITHM,
      key_id: this.keyId,
      key_version: this.keyVersion,
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      authentication_tag: cipher.getAuthTag().toString("base64"),
    };
  }

  async unwrapKey(wrapped, { aad } = {}) {
    if (wrapped?.provider_id !== this.providerId || wrapped?.key_id !== this.keyId || wrapped?.key_version !== this.keyVersion) {
      throw new ManagedKeyRequiredError("The wrapped DEK does not match the configured local test key version");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.wrappingKey, Buffer.from(wrapped.nonce, "base64"));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(wrapped.authentication_tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, "base64")), decipher.final()]);
  }
}

function requireProductionManagedKeyProvider(provider) {
  if (!(provider instanceof ManagedKeyProvider) || provider.productionReady !== true) {
    throw new ManagedKeyRequiredError();
  }
  const metadata = provider.getActiveKeyMetadata();
  if (!metadata?.key_id || !metadata?.key_version || !metadata?.provider_id) {
    throw new ManagedKeyRequiredError("Managed key metadata is incomplete");
  }
  return provider;
}

module.exports = {
  ManagedKeyProvider,
  UnavailableManagedKeyProvider,
  LocalTestManagedKeyProvider,
  requireProductionManagedKeyProvider,
};
