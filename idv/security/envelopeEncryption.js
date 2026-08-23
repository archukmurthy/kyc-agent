"use strict";

const { randomBytes, createCipheriv, createDecipheriv } = require("crypto");
const { assertNoRawEvidence } = require("../domain/canonical");

const DATA_ALGORITHM = "AES-256-GCM";
const ENVELOPE_VERSION = 1;

function canonicalAad(parts) {
  const ordered = Object.fromEntries(Object.keys(parts || {}).sort().map((key) => [key, parts[key]]));
  return Buffer.from(JSON.stringify(ordered), "utf8");
}

class EnvelopeEncryption {
  constructor({ managedKeyProvider }) {
    if (!managedKeyProvider) throw new TypeError("managedKeyProvider is required");
    this.keys = managedKeyProvider;
  }

  async encryptJson(value, aadParts) {
    assertNoRawEvidence(value);
    const aad = canonicalAad(aadParts);
    const dek = randomBytes(32);
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv("aes-256-gcm", dek, nonce);
      cipher.setAAD(aad);
      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const wrappedDek = await this.keys.wrapKey(dek, { aad });
      return {
        envelope_version: ENVELOPE_VERSION,
        algorithm: DATA_ALGORITHM,
        ciphertext: ciphertext.toString("base64"),
        nonce: nonce.toString("base64"),
        authentication_tag: cipher.getAuthTag().toString("base64"),
        wrapped_dek: wrappedDek,
        kms_provider: wrappedDek.provider_id,
        kms_key_id: wrappedDek.key_id,
        kms_key_version: wrappedDek.key_version,
      };
    } finally {
      dek.fill(0);
    }
  }

  async decryptJson(envelope, aadParts) {
    if (envelope?.envelope_version !== ENVELOPE_VERSION || envelope?.algorithm !== DATA_ALGORITHM) {
      throw new TypeError("Unsupported identity encryption envelope");
    }
    const aad = canonicalAad(aadParts);
    const dek = await this.keys.unwrapKey(envelope.wrapped_dek, { aad });
    try {
      const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(envelope.nonce, "base64"));
      decipher.setAAD(aad);
      decipher.setAuthTag(Buffer.from(envelope.authentication_tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8"));
    } finally {
      dek.fill(0);
    }
  }
}

module.exports = { EnvelopeEncryption, DATA_ALGORITHM, ENVELOPE_VERSION, canonicalAad };
