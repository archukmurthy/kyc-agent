"use strict";

const MAX_LOCATOR_TEXT = 2000;

function bounded(value, limit = MAX_LOCATOR_TEXT) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, limit) : null;
}

function normalizedRegion(region, media) {
  if (!region || typeof region !== "object") return null;
  if (region.coordinate_space !== "original_artifact_pixels") return null;
  const sourceWidth = Number(region.source_width); const sourceHeight = Number(region.source_height);
  const x = Number(region.x); const y = Number(region.y); const width = Number(region.width); const height = Number(region.height);
  if (![sourceWidth,sourceHeight,x,y,width,height].every(Number.isFinite)) return null;
  if (sourceWidth !== media.width || sourceHeight !== media.height || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > sourceWidth || y + height > sourceHeight) return null;
  return { coordinateSpace: "original_artifact_pixels", sourceWidth, sourceHeight, x, y, width, height };
}

function normalizeLocator(locator, contentItem) {
  if (!locator || typeof locator !== "object" || String(locator.artifact_id || "") !== contentItem.artifactId) return null;
  const excerpt = bounded(locator.excerpt);
  const description = bounded(locator.description);
  const metadata = { method: bounded(locator.locator_method, 200), qualified: locator.qualified === true };
  if (contentItem.kind === "text" && (contentItem.mediaType === "application/json" || contentItem.mediaType.endsWith("+json"))) {
    if (!excerpt) return null;
    const jsonPath=bounded(locator.json_path,1000);return { locatorKind: "json", jsonPath, domReference: null, pageStart: null, pageEnd: null, supportExcerpt: excerpt, supportDescription: description, region: null, locatorMetadata: { ...metadata, qualified: metadata.qualified || !jsonPath } };
  }
  if (contentItem.kind === "text") {
    if (!excerpt) return null;
    const domReference=bounded(locator.dom_reference,1000);return { locatorKind: "html", jsonPath: null, domReference, pageStart: null, pageEnd: null, supportExcerpt: excerpt, supportDescription: description, region: null, locatorMetadata: { ...metadata, qualified: metadata.qualified || !domReference } };
  }
  if (contentItem.kind === "document") {
    const pageStart = Number(locator.page_start); const pageEnd = locator.page_end == null ? pageStart : Number(locator.page_end);
    if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart || pageEnd > contentItem.media.pageCount || (!excerpt && !description)) return null;
    return { locatorKind: "pdf", jsonPath: null, domReference: null, pageStart, pageEnd, supportExcerpt: excerpt, supportDescription: description, region: null, locatorMetadata: metadata };
  }
  if (contentItem.kind === "image") {
    if (!excerpt && !description) return null;
    return { locatorKind: "image", jsonPath: null, domReference: null, pageStart: null, pageEnd: null, supportExcerpt: excerpt, supportDescription: description, region: normalizedRegion(locator.region, contentItem.media), locatorMetadata: metadata };
  }
  return null;
}

function fallbackTextLocator(fact, contentItem) {
  const excerpt = bounded(fact.raw);
  if (!excerpt || contentItem.kind !== "text") return null;
  return { artifact_id: contentItem.artifactId, excerpt, locator_method: "provider_raw_support", qualified: true };
}

function assessFactLocators(fact, contentItems) {
  const byId = new Map(contentItems.map((item) => [item.artifactId, item]));
  const supplied = Array.isArray(fact.supportLocators) ? fact.supportLocators : [];
  const valid = []; const limitations = [];
  for (const artifactId of fact.supportingArtifactIds || []) {
    const contentItem = byId.get(artifactId);
    if (!contentItem) { limitations.push(`No verified input exists for supporting Artifact ${artifactId}`); continue; }
    const candidates = supplied.filter((item) => String(item?.artifact_id || "") === artifactId);
    if (!candidates.length) {
      const fallback = fallbackTextLocator(fact, contentItem);
      if (fallback) candidates.push(fallback);
    }
    const normalized = candidates.map((item) => normalizeLocator(item, contentItem)).filter(Boolean);
    if (!normalized.length) limitations.push(`A valid ${contentItem.kind} source locator was not returned for supporting Artifact ${artifactId}`);
    else normalized.forEach((locator) => valid.push({ artifactId, ...locator }));
  }
  return { valid, limitations };
}

module.exports = { MAX_LOCATOR_TEXT, assessFactLocators, normalizeLocator, normalizedRegion };
