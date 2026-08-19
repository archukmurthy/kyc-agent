"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

class MemoryArtifactStore {
  constructor() { this.items = new Map(); }
  async put(key, bytes, contentType) {
    this.items.set(key, { bytes: Buffer.from(bytes), contentType });
    return { provider: "memory", key, reference: `memory://${key}` };
  }
  get(key) { return this.items.get(key); }
  async read(key) {
    const item = this.items.get(key);
    if (!item) throw new Error("Artifact storage object was not found");
    return { bytes: Buffer.from(item.bytes), contentType: item.contentType || null };
  }
}

class FileArtifactStore {
  constructor(root) { this.root = path.resolve(root); }
  resolveKey(key) {
    const target = path.resolve(this.root, String(key || ""));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Unsafe artifact storage key");
    return target;
  }
  async put(key, bytes) {
    const safeKey = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    let target = this.resolveKey(safeKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      const existing = await fs.readFile(target);
      if (!existing.equals(Buffer.from(bytes))) {
        const suffix = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
        target = `${target}.${suffix}`;
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await fs.writeFile(target, bytes, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      const existing = await fs.readFile(target);
      if (!existing.equals(Buffer.from(bytes))) throw new Error("Artifact key collision with different bytes");
    });
    return { provider: "filesystem", key: path.relative(this.root, target), reference: target };
  }
  async read(key) { return { bytes: await fs.readFile(this.resolveKey(key)), contentType: null }; }
}

class VercelBlobArtifactStore {
  async put(key, bytes, contentType) {
    const { put } = await import("@vercel/blob");
    const result = await put(key, bytes, { access: "private", contentType, addRandomSuffix: true });
    return { provider: "vercel_blob", key: result.pathname, reference: result.url };
  }
  async read(key) {
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("Artifact Blob object was not found");
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    return { bytes: Buffer.concat(chunks), contentType: result.blob.contentType || null };
  }
}

module.exports = { MemoryArtifactStore, FileArtifactStore, VercelBlobArtifactStore };
