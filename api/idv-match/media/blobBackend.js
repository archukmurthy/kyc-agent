"use strict";

// Pluggable ciphertext backend for document media. The security-critical work
// (envelope encryption, integrity, authorized retrieval) is identical whatever
// backs the bytes, so unit tests use the in-memory backend and the default
// `node --test` run never touches the network. The real private Vercel Blob
// backend is used at runtime and in the guarded integration test only.

// In-memory backend for hermetic tests / default dev.
class InMemoryBlobBackend {
  constructor() { this.objects = new Map(); }
  async put(key, bytes) { this.objects.set(key, Buffer.from(bytes)); return { key }; }
  async get(key) {
    const value = this.objects.get(key);
    if (!value) throw new Error(`blob not found: ${key}`);
    return Buffer.from(value);
  }
  async del(key) { this.objects.delete(key); }
}

// Real private Vercel Blob backend. Stores CIPHERTEXT only, access 'private',
// caller-supplied unguessable key (no random suffix). Retrieval is a
// token-authorized read, never a public URL.
class VercelBlobBackend {
  constructor({ token = process.env.BLOB_READ_WRITE_TOKEN, blob } = {}) {
    if (!token) throw new Error("VercelBlobBackend requires BLOB_READ_WRITE_TOKEN");
    this.token = token;
    this.blob = blob || require("@vercel/blob");
  }
  async put(key, bytes, { contentType } = {}) {
    const res = await this.blob.put(key, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      contentType: contentType || "application/octet-stream",
      token: this.token,
    });
    return { key, url: res.url };
  }
  async get(key) {
    // `get` requires the access level and returns a { stream } (web
    // ReadableStream) for a private blob read under the rw token.
    const res = await this.blob.get(key, { access: "private", token: this.token });
    if (!res) throw new Error(`blob not found: ${key}`);
    const stream = res.stream || res.body;
    if (!stream) throw new Error(`blob body missing: ${key}`);
    return Buffer.from(await new Response(stream).arrayBuffer());
  }
  async del(key) { await this.blob.del(key, { token: this.token }); }
}

// Runtime default: real Blob when a token is configured, else in-memory (dev).
function defaultBlobBackend() {
  return process.env.BLOB_READ_WRITE_TOKEN ? new VercelBlobBackend() : new InMemoryBlobBackend();
}

module.exports = { InMemoryBlobBackend, VercelBlobBackend, defaultBlobBackend };
