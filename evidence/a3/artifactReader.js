"use strict";

const { FileArtifactStore, VercelBlobArtifactStore } = require("../a2/artifactStore");

class EvidenceArtifactReader {
  constructor({ filesystemRoot = null, blobStore = null } = {}) {
    this.filesystem = filesystemRoot ? new FileArtifactStore(filesystemRoot) : null;
    this.blob = blobStore || new VercelBlobArtifactStore();
  }
  async read(artifact) {
    if (artifact.fixtureContent) return { bytes: Buffer.from(artifact.fixtureContent), contentType: artifact.mediaType || null };
    if (artifact.storageProvider === "filesystem") {
      if (!this.filesystem) throw Object.assign(new Error("Filesystem Artifact storage is not configured"), { code: "artifact_storage_unavailable" });
      return this.filesystem.read(artifact.storageKey);
    }
    if (artifact.storageProvider === "vercel_blob") return this.blob.read(artifact.storageKey || artifact.storageReference);
    throw Object.assign(new Error(`Artifact storage provider ${artifact.storageProvider || "(missing)"} is unsupported for reading`), { code: "artifact_storage_unavailable" });
  }
}

module.exports = { EvidenceArtifactReader };
