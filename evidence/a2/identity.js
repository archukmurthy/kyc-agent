"use strict";

const { createHash } = require("node:crypto");

function stableUuid(...parts) {
  const hex = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function normalizeCompanyNumber(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^(?:[A-Z]{2}\d{6}|\d{1,8})$/.test(normalized)) throw new Error("A valid Companies House companyNumber is required");
  return /^\d+$/.test(normalized) ? normalized.padStart(8, "0") : normalized;
}

function validateCompaniesHouseRequest(input = {}) {
  if (input.producer !== "companies_house") throw new Error("producer must be companies_house");
  const coordinates = input.collectionCoordinates || input.collection_coordinates;
  if (!coordinates || coordinates.jurisdiction !== "GB") throw new Error("Companies House jurisdiction must be GB");
  const requestKey = String(input.producerRequestKey || input.producer_request_key || "").trim();
  if (!requestKey) throw new Error("producerRequestKey is required");
  return {
    producer: "companies_house",
    producerRequestKey: requestKey,
    collectionCoordinates: { jurisdiction: "GB", companyNumber: normalizeCompanyNumber(coordinates.companyNumber) },
    mode: input.mode === "fixture" ? "fixture" : "live",
    tenantId: input.tenantId || "nium",
    contextReference: input.contextReference || null,
  };
}

module.exports = { stableUuid, normalizeCompanyNumber, validateCompaniesHouseRequest };
