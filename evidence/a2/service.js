"use strict";

const { sha256, validateEvidenceGraph } = require("../a1/domain");
const { stableUuid, validateCompaniesHouseRequest } = require("./identity");
const { extractProfile, extractOfficers, extractPsc } = require("./extractor");

// Stage A2 runs as a standalone Evidence Lab producer. Upstream KYC/Onboarding
// will eventually supply the applicable configured schema and information needs;
// that context-handoff contract is deliberately outside A2. This bounded default
// prevents Companies House itself from being represented as inherently FI-specific.
const STANDALONE_LAB_EXTRACTION_CONTEXT = Object.freeze({
  schemaReference: "evidence-lab:a2-standalone-current",
  schemaVersionReference: null,
  tenantConfigVersion: null,
  informationNeeds: Object.freeze([
    "business_name", "registration_number", "incorporation_date", "business_type",
    "registered_address_line1", "registered_address_line2", "registered_address_city",
    "registered_address_state", "registered_address_postcode", "registered_address_country",
    "director_names", "ubo_parent_company", "ubo_share_percentage",
  ]),
});

function errorMessage(error) { return error && error.message ? error.message : "Unknown acquisition failure"; }

class CompaniesHouseEvidenceService {
  constructor({ repository, artifactStore, client, websiteCapture, now = () => new Date().toISOString() }) {
    if (!repository || !artifactStore || !client || !websiteCapture) throw new Error("A2 service dependencies are required");
    this.repository = repository; this.artifactStore = artifactStore; this.client = client; this.websiteCapture = websiteCapture; this.now = now;
  }

  async collect(input) {
    const request = validateCompaniesHouseRequest(input);
    const existing = await this.repository.find(request.producer, request.producerRequestKey);
    if (existing && ["successful", "partial", "failed", "inconclusive"].includes(existing.status)) {
      return { collection: existing, replayed: true, inspection: { artifacts: {} }, summary: { collectionId: existing.id, producer: existing.producer, mode: existing.mode, coordinates: existing.collectionCoordinates || existing.collection_coordinates, status: existing.status, startedAt: existing.startedAt || existing.started_at, completedAt: existing.completedAt || existing.completed_at, subject: null, acquisitions: [], assets: [], artifacts: [], extractionRuns: [], extractedValues: [] } };
    }
    const startedAt = this.now();
    const collectionId = stableUuid("collection", request.producer, request.producerRequestKey);
    const baseCollection = {
      id: collectionId, producer: request.producer, producerRequestKey: request.producerRequestKey,
      subjectReferenceId: null, collectionCoordinates: request.collectionCoordinates, mode: request.mode,
      status: "running", startedAt, completedAt: null, failureReason: null, producerMetadata: {}, createdAt: startedAt,
    };
    await this.repository.begin(baseCollection);

    const number = request.collectionCoordinates.companyNumber;
    const subjectId = stableUuid("subject", "companies_house", number);
    const contextId = stableUuid(collectionId, "context");
    const requirementId = stableUuid(collectionId, "requirement");
    const graph = this.emptyGraph({ subjectId, contextId, requirementId, number, request, startedAt });
    const inspection = { artifacts: {} };

    graph.subjects.push({ id: subjectId, subjectType: "company", identifierScheme: "companies_house_company_number", jurisdiction: "GB", identifierValue: number, displayName: null, externalSystem: "companies_house", externalReference: number, createdAt: startedAt });
    graph.contexts.push({ id: contextId, tenantId: request.tenantId, contextType: "evidence_lab", externalContextReference: request.contextReference || collectionId, subjectReferenceId: subjectId, createdAt: startedAt });
    graph.requirements.push({ id: requirementId, contextId, subjectReferenceId: subjectId, requirementKey: "verify_company_registration", description: "Verify Companies House registration, officers and control", status: "open", createdAt: startedAt });
    for (const field of STANDALONE_LAB_EXTRACTION_CONTEXT.informationNeeds) {
      graph.informationNeeds.push({ id: stableUuid(requirementId, field), requirementId, schemaReference: STANDALONE_LAB_EXTRACTION_CONTEXT.schemaReference, schemaVersionReference: STANDALONE_LAB_EXTRACTION_CONTEXT.schemaVersionReference, tenantConfigVersion: STANDALONE_LAB_EXTRACTION_CONTEXT.tenantConfigVersion, schemaFieldId: field, createdAt: startedAt });
    }

    let profile;
    try {
      profile = await this.client.profile(number);
      const returned = String(profile.data.company_number || "").toUpperCase();
      if (returned !== number) {
        this.failureAcquisition(graph, collectionId, subjectId, contextId, "profile", profile.url, startedAt, "inconclusive", `Companies House response company number ${returned || "(missing)"} did not correspond to requested ${number}`);
        const collection = { ...baseCollection, subjectReferenceId: null, status: "inconclusive", completedAt: this.now(), failureReason: "Authoritative response company number mismatch", producerMetadata: { sourceStatuses: { profile: "inconclusive" } } };
        validateEvidenceGraph(graph);
        const persisted = await this.persistFinal(collection, graph);
        return { ...persisted, inspection, summary: this.summarize(collection, graph) };
      }
      graph.subjects[0].displayName = profile.data.company_name || null;
      await this.successApi(graph, inspection, { collectionId, subjectId, contextId, requirementId, type: "profile", title: "Companies House company profile", pages: [{ ...profile, pageNumber: 1, startIndex: 0 }], extractor: extractProfile, startedAt });
    } catch (error) {
      this.failureAcquisition(graph, collectionId, subjectId, contextId, "profile", `https://api.company-information.service.gov.uk/company/${number}`, startedAt, "failed", errorMessage(error));
    }

    await this.collectApiArea(graph, inspection, { collectionId, subjectId, contextId, requirementId, number, type: "officers", title: "Companies House officers", call: () => this.client.officers(number), extractor: extractOfficers, startedAt });
    await this.collectApiArea(graph, inspection, { collectionId, subjectId, contextId, requirementId, number, type: "psc", title: "Companies House persons with significant control", call: () => this.client.psc(number), extractor: extractPsc, startedAt });
    await this.collectWebsite(graph, inspection, { collectionId, subjectId, contextId, requirementId, number, type: "overview_website", title: "Companies House company overview website", startedAt });
    await this.collectWebsite(graph, inspection, { collectionId, subjectId, contextId, requirementId, number, type: "officers_website", title: "Companies House officers website", startedAt });
    await this.collectWebsite(graph, inspection, { collectionId, subjectId, contextId, requirementId, number, type: "psc_website", title: "Companies House persons with significant control website", startedAt });

    validateEvidenceGraph(graph);
    const apiAcquisitions = graph.acquisitions.filter((a) => ["profile", "officers", "psc"].includes(a.producerMetadata.sourceArea));
    const apiSuccesses = apiAcquisitions.filter((a) => a.outcome === "successful").length;
    const status = apiSuccesses === 3 ? "successful" : apiSuccesses > 0 ? "partial" : "failed";
    const websiteAcquisitions = graph.acquisitions.filter((a) => a.producerMetadata.sourceKind === "website");
    const captureStatuses = websiteAcquisitions.map((a) => a.producerMetadata.captureStatus);
    const humanViewableEvidenceStatus = captureStatuses.every((value) => value === "complete") ? "complete" : captureStatuses.every((value) => value === "unavailable") ? "unavailable" : "incomplete";
    const structuredEvidenceStatus = status === "successful" ? "complete" : "incomplete";
    const sourceStatuses = Object.fromEntries(graph.acquisitions.map((a) => [a.producerMetadata.sourceArea, a.outcome]));
    const collection = { ...baseCollection, subjectReferenceId: subjectId, status, completedAt: this.now(), failureReason: status === "failed" ? "All authoritative API acquisitions failed" : null, producerMetadata: { sourceStatuses, structuredEvidenceStatus, humanViewableEvidenceStatus } };
    const persisted = await this.persistFinal(collection, graph);
    return { ...persisted, inspection, summary: this.summarize(collection, graph) };
  }

  emptyGraph() { return { subjects: [], contexts: [], requirements: [], informationNeeds: [], acquisitions: [], assets: [], accessScopes: [], artifacts: [], requirementAssets: [], extractionRuns: [], extractedValues: [] }; }

  async persistFinal(collection, graph) {
    try { return await this.repository.persist(collection, graph); }
    catch (error) {
      if (typeof this.repository.markPersistenceFailure === "function") await this.repository.markPersistenceFailure(collection, error);
      throw error;
    }
  }

  failureAcquisition(graph, collectionId, subjectId, contextId, type, locator, startedAt, outcome, reason, metadata = {}) {
    const website = type.endsWith("_website");
    graph.acquisitions.push({ id: stableUuid(collectionId, type, "acquisition"), collectionOperationId: collectionId, contextId, tenantId: graph.contexts[0]?.tenantId || "nium", subjectReferenceId: subjectId, sourceType: website ? "public_website" : "public_registry_api", sourceProvider: "Companies House", acquisitionMethod: website ? "browser_capture" : "official_api", actorType: "system", actorId: "evidence-platform-companies-house", outcome, outcomeReason: reason, sourceLocator: locator || null, startedAt, completedAt: this.now(), producerMetadata: { sourceArea: type, sourceKind: website ? "website" : "api", ...(website ? { captureStatus: "unavailable" } : {}), ...metadata }, createdAt: startedAt });
  }

  async collectApiArea(graph, inspection, options) {
    try { await this.successApi(graph, inspection, { ...options, pages: await options.call() }); }
    catch (error) { this.failureAcquisition(graph, options.collectionId, options.subjectId, options.contextId, options.type, null, options.startedAt, "failed", errorMessage(error), { partialPageCount: error.partialPages?.length || 0, paginationComplete: false }); }
  }

  async successApi(graph, inspection, { collectionId, subjectId, contextId, requirementId, type, title, pages, extractor, startedAt }) {
    const acquisitionId = stableUuid(collectionId, type, "acquisition");
    const assetId = stableUuid(collectionId, type, "asset");
    graph.acquisitions.push({ id: acquisitionId, collectionOperationId: collectionId, contextId, tenantId: graph.contexts[0].tenantId, subjectReferenceId: subjectId, sourceType: "public_registry_api", sourceProvider: "Companies House", acquisitionMethod: "official_api", actorType: "system", actorId: "evidence-platform-companies-house", outcome: "successful", outcomeReason: null, sourceLocator: pages[0].url, startedAt, completedAt: this.now(), producerMetadata: { sourceArea: type, pageCount: pages.length, paginationComplete: true }, createdAt: startedAt });
    graph.assets.push({ id: assetId, acquisitionId, subjectReferenceId: subjectId, evidenceType: `companies_house_${type}`, title, accessClass: "public", observedAt: startedAt, createdAt: startedAt });
    graph.requirementAssets.push({ requirementId, assetId, associatedContextId: contextId, associatedAt: startedAt });
    for (const page of pages) {
      const artifactId = stableUuid(assetId, "page", page.pageNumber);
      const stored = await this.artifactStore.put(`evidence/${collectionId}/${type}/page-${page.pageNumber}.json`, page.bytes, page.contentType);
      graph.artifacts.push({ id: artifactId, assetId, representationType: "companies_house_api_response", mediaType: page.contentType, originalName: null, storageProvider: stored.provider, storageKey: stored.key, storageReference: stored.reference, sizeBytes: page.bytes.length, fingerprintAlgorithm: "sha256", fingerprintValue: sha256(page.bytes), capturedAt: startedAt, artifactMetadata: { url: page.url, httpStatus: page.status, pageNumber: page.pageNumber, startIndex: page.startIndex }, createdAt: startedAt });
      inspection.artifacts[artifactId] = { kind: "json", content: page.bytes.toString("utf8") };
      const runId = stableUuid(artifactId, "extraction");
      graph.extractionRuns.push({ id: runId, assetId, artifactId, extractorType: "deterministic", extractorName: `companies-house-${type}-mapper`, extractorVersion: "a2-v1", schemaReference: STANDALONE_LAB_EXTRACTION_CONTEXT.schemaReference, schemaVersionReference: STANDALONE_LAB_EXTRACTION_CONTEXT.schemaVersionReference, tenantConfigVersion: STANDALONE_LAB_EXTRACTION_CONTEXT.tenantConfigVersion, status: "completed", startedAt, completedAt: this.now(), runMetadata: { pageNumber: page.pageNumber, extractionContext: "standalone_evidence_lab_default" }, createdAt: startedAt });
      const allowedFields = new Set(STANDALONE_LAB_EXTRACTION_CONTEXT.informationNeeds);
      extractor(page.data).filter((item) => allowedFields.has(item.schemaFieldId)).forEach((item, index) => graph.extractedValues.push({ id: stableUuid(runId, item.schemaFieldId, index), extractionRunId: runId, schemaFieldId: item.schemaFieldId, extractedValue: item.extractedValue, confidence: item.confidence, rawRepresentation: item.rawRepresentation, createdAt: startedAt }));
    }
  }

  async collectWebsite(graph, inspection, { collectionId, subjectId, contextId, requirementId, number, type, title, startedAt }) {
    const suffix = type === "officers_website" ? "/officers" : type === "psc_website" ? "/persons-with-significant-control" : "";
    const url = `https://find-and-update.company-information.service.gov.uk/company/${number}${suffix}`;
    try {
      const capture = await this.websiteCapture(number, type);
      const acquisitionId = stableUuid(collectionId, type, "acquisition");
      const assetId = stableUuid(collectionId, type, "asset");
      const pendingArtifacts = [];
      const representationOutcomes = [];
      for (const page of capture.pages || []) {
        for (const [kind, bytes, media] of [["rendered_html", page.html, "text/html; charset=utf-8"], ["screenshot", page.screenshot, "image/png"]]) {
          if (!bytes) {
            representationOutcomes.push({ pageNumber: page.pageNumber, representationType: kind, outcome: "failed", reason: kind === "screenshot" ? page.screenshotError || "Screenshot was not produced" : "Rendered HTML was not produced" });
            continue;
          }
          const artifactId = stableUuid(assetId, "page", page.pageNumber, kind);
          const extension = kind === "screenshot" ? "png" : "html";
          try {
            const stored = await this.artifactStore.put(`evidence/${collectionId}/${type}/page-${page.pageNumber}.${extension}`, bytes, media);
            pendingArtifacts.push({ id: artifactId, assetId, representationType: kind, mediaType: media, originalName: `page-${page.pageNumber}.${extension}`, storageProvider: stored.provider, storageKey: stored.key, storageReference: stored.reference, sizeBytes: bytes.length, fingerprintAlgorithm: "sha256", fingerprintValue: sha256(bytes), capturedAt: page.capturedAt || startedAt, artifactMetadata: { url: page.url, httpStatus: page.status, pageNumber: page.pageNumber, pageOrder: page.pageNumber }, createdAt: startedAt });
            inspection.artifacts[artifactId] = kind === "screenshot" ? { kind: "image", content: bytes.toString("base64"), mediaType: media } : { kind: "html", content: bytes.toString("utf8") };
            representationOutcomes.push({ pageNumber: page.pageNumber, representationType: kind, outcome: "successful" });
          } catch (error) {
            representationOutcomes.push({ pageNumber: page.pageNumber, representationType: kind, outcome: "failed", reason: errorMessage(error) });
          }
        }
      }
      if (!pendingArtifacts.length) {
        const reason = capture.failureReason || representationOutcomes.map((item) => item.reason).filter(Boolean).join("; ") || "Website capture produced no preservable artifacts";
        this.failureAcquisition(graph, collectionId, subjectId, contextId, type, capture.url || url, startedAt, "failed", reason, { captureStatus: "unavailable", pageCount: capture.pages?.length || 0, paginationComplete: !!capture.paginationComplete, representationOutcomes });
        return;
      }
      const captureComplete = !!capture.paginationComplete && representationOutcomes.length === (capture.pages?.length || 0) * 2 && representationOutcomes.every((item) => item.outcome === "successful");
      const incompleteReasons = [capture.failureReason, ...representationOutcomes.filter((item) => item.outcome !== "successful").map((item) => `page ${item.pageNumber} ${item.representationType}: ${item.reason}`)].filter(Boolean);
      graph.acquisitions.push({ id: acquisitionId, collectionOperationId: collectionId, contextId, tenantId: graph.contexts[0].tenantId, subjectReferenceId: subjectId, sourceType: "public_website", sourceProvider: "Companies House", acquisitionMethod: "browser_capture", actorType: "system", actorId: "evidence-platform-companies-house", outcome: "successful", outcomeReason: null, sourceLocator: capture.url || url, startedAt, completedAt: this.now(), producerMetadata: { sourceArea: type, sourceKind: "website", captureStatus: captureComplete ? "complete" : "incomplete", captureReason: incompleteReasons.join("; ") || null, pageCount: capture.pages?.length || 0, paginationComplete: !!capture.paginationComplete, representationOutcomes }, createdAt: startedAt });
      graph.assets.push({ id: assetId, acquisitionId, subjectReferenceId: subjectId, evidenceType: `companies_house_${type}`, title, accessClass: "public", observedAt: startedAt, createdAt: startedAt });
      graph.requirementAssets.push({ requirementId, assetId, associatedContextId: contextId, associatedAt: startedAt });
      graph.artifacts.push(...pendingArtifacts);
    } catch (error) { this.failureAcquisition(graph, collectionId, subjectId, contextId, type, url, startedAt, "failed", errorMessage(error)); }
  }

  summarize(collection, graph) {
    return { collectionId: collection.id, producer: collection.producer, mode: collection.mode, coordinates: collection.collectionCoordinates, status: collection.status, structuredEvidenceStatus: collection.producerMetadata.structuredEvidenceStatus || null, humanViewableEvidenceStatus: collection.producerMetadata.humanViewableEvidenceStatus || null, startedAt: collection.startedAt, completedAt: collection.completedAt, subject: graph.subjects[0] || null, acquisitions: graph.acquisitions.map((a) => ({ id: a.id, sourceArea: a.producerMetadata.sourceArea, outcome: a.outcome, reason: a.outcomeReason, source: a.sourceLocator, metadata: a.producerMetadata })), assets: graph.assets, artifacts: graph.artifacts, extractionRuns: graph.extractionRuns, extractedValues: graph.extractedValues };
  }
}

module.exports = { CompaniesHouseEvidenceService, STANDALONE_LAB_EXTRACTION_CONTEXT };
