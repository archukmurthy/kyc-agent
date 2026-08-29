"use strict";

function source(id, overrides = {}) {
  return {
    id,
    source: "Legacy source register",
    sourceUrl: "https://registry.example/filing/" + id,
    ...overrides,
  };
}

function node(id, name, type, overrides = {}) {
  return { id, name, type, jurisdiction: "GB", registrationNumber: null, ...overrides };
}

function edge(id, from, to, overrides = {}) {
  return {
    id,
    from,
    to,
    type: "ownership",
    ownershipPercentage: 40,
    ownershipIsMinimum: false,
    evidenceIds: ["source-1"],
    metadata: {},
    ...overrides,
  };
}

function response({ nodes, edges, evidence, ...overrides } = {}) {
  return {
    status: "resolved",
    ownershipGraph: {
      rootEntityId: "legacy-root-node",
      nodes: nodes || [
        node("legacy-root-node", "Example Customer Ltd", "company", { registrationNumber: "01234567" }),
        node("legacy-owner-node", "Alice Owner", "individual"),
      ],
      edges: edges || [edge("legacy-edge-1", "legacy-owner-node", "legacy-root-node")],
    },
    evidence: evidence || [source("source-1")],
    run: { id: "legacy-run-1" },
    audit: { id: "legacy-audit-1" },
    ...overrides,
  };
}

const FIXTURES = Object.freeze({
  L01: response(),
  L02: response({
    edges: [edge("band-edge", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: 25,
      ownershipIsMinimum: true,
      metadata: {
        ownershipIsMinimum: true,
        naturesOfControl: ["ownership-of-shares-25-to-50-percent"],
      },
    })],
    evidence: [source("source-1", { naturesOfControl: ["ownership-of-shares-25-to-50-percent"] })],
  }),
  L03: response({
    edges: [edge("voting-edge", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: 60,
      metadata: { naturesOfControl: ["voting-rights-50-to-75-percent"] },
    })],
  }),
  L04: response({
    edges: [edge("ambiguous-edge", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: 25,
      metadata: { naturesOfControl: ["ownership-or-voting-rights-25-to-50-percent"] },
    })],
  }),
  L05: response({
    nodes: [
      node("legacy-root-node", "Example Customer Ltd", "company", { registrationNumber: "01234567" }),
      node("legacy-owner-node", "HoldCo Ltd", "company", { registrationNumber: "09876543", jurisdiction: "GB" }),
    ],
  }),
  L06: response({
    ubos: [{ personId: "legacy-owner-node", ownership: 40, basis: "legacy-threshold" }],
    ownership: { individuals: [{ individualId: "legacy-owner-node", effectiveOwnership: 99 }] },
    control: [{ personId: "legacy-owner-node", legacyController: true }],
  }),
  L07: response({
    ownershipGaps: { status: "needs_customer_evidence", recommendations: ["Ask customer"] },
    stakeholders: [{ id: "legacy-owner-node", roles: ["ubo"], confidence: 100 }],
    missingInformation: [{ reason: "legacy remediation" }],
    reviewerPresentation: { badge: "legacy-approved" },
  }),
  L08: response({
    edges: [
      edge("assertion-a", "legacy-owner-node", "legacy-root-node", { ownershipPercentage: 40, evidenceIds: ["source-a"] }),
      edge("assertion-b", "legacy-owner-node", "legacy-root-node", { ownershipPercentage: 45, evidenceIds: ["source-b"] }),
    ],
    evidence: [source("source-a"), source("source-b")],
  }),
  L09: response({ edges: [], evidence: [] }),
  L10: response({ status: "resolved" }),
  L11: { status: "resolved", ubos: [] },
  L12: Object.freeze({ transportError: { code: "ECONNREFUSED", message: "offline fixture" } }),
  L13: Object.freeze({ statuses: [429, 401, 503], timeoutCode: "ETIMEDOUT" }),
  L14: response({
    edges: [edge("weak-source", "legacy-owner-node", "legacy-root-node", { evidenceIds: [] })],
    evidence: [source("operation-only-source")],
  }),
});

function cloneFixture(id) {
  return JSON.parse(JSON.stringify(FIXTURES[id]));
}

module.exports = { FIXTURES, cloneFixture, edge, node, response, source };
