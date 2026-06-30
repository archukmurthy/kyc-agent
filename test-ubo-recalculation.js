"use strict";
const assert = require("assert");
const { recalculateOwnership } = require("./agents/ubo/realTimeRecalculationEngine");
const root = { name: "Customer Ltd", jurisdiction: "GB", type: "company" };
const result = recalculateOwnership({ rootEntity: root, rules: { uboThreshold: 25 }, evidence: [{ source: "uploaded_shareholder_register", evidence: [{ id: "register-1", source: "Customer shareholder register" }], relationships: [{ owner: { name: "Jane Doe", type: "individual", jurisdiction: "GB" }, ownedEntity: root, ownershipPercentage: 60, evidenceIds: ["register-1"] }] }] });
assert.equal(result.ubos[0].name, "Jane Doe"); assert.equal(result.ubos[0].ownership, 60); assert.equal(result.stakeholders[0].roles[0], "ubo"); console.log("Real-time ownership recalculation test passed");
