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
}

class FileArtifactStore {
  constructor(root) { this.root = path.resolve(root); }
  async put(key, bytes) {
    const safeKey = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    let target = path.resolve(this.root, safeKey);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Unsafe artifact storage key");
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
}

class VercelBlobArtifactStore {
  async put(key, bytes, contentType) {
    const { put } = await import("@vercel/blob");
    const result = await put(key, bytes, { access: "private", contentType, addRandomSuffix: true });
    return { provider: "vercel_blob", key: result.pathname, reference: result.url };
  }
}

module.exports = { MemoryArtifactStore, FileArtifactStore, VercelBlobArtifactStore };
