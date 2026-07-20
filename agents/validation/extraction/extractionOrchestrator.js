async function extractDocument(request) {
  const document = request && request.document ? request.document : {};

  return {
    provider: "skeleton",
    documentName: document.name || "Untitled document",
    mimeType: document.type || "application/octet-stream",
    sizeBytes: document.size || 0,
    text: document.text || "",
    fields: document.fields || {},
    pages: [],
    extractionMetadata: {
      provider: "skeleton",
    },
  };
}

var extractionOrchestratorExported = {
  extractDocument,
};

if (typeof module !== "undefined") {
  module.exports = extractionOrchestratorExported;
}

if (typeof window !== "undefined") {
  window.ValidationExtractionOrchestrator = extractionOrchestratorExported;
}
