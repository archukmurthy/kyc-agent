"use strict";

const assert = require("assert");
const { runUboFramework } = require("./agents/ubo/uboOrchestrator");

(async () => {
  const result = await runUboFramework({
    entityName: "Customer Ltd", jurisdiction: "GB",
    adapters: {
      registry: async ({ entity }) => {
        if (entity.name === "Customer Ltd") return { statements: [{ owner: { name: "Parent Ltd", type: "company", jurisdiction: "SG" }, ownedEntity: entity, ownershipPercentage: 80, evidenceIds: ["a"] }] };
        if (entity.name === "Parent Ltd") return { statements: [{ owner: { name: "Jane Doe", type: "individual", jurisdiction: "SG" }, ownedEntity: entity, ownershipPercentage: 60, evidenceIds: ["b"] }] };
        return {};
      },
    },
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.ubos.length, 1);
  assert.equal(result.ubos[0].ownership, 48);
  assert.equal(result.explanations[0].reasoning[0].statements.length, 2);
  console.log("UBO framework smoke test passed");
})().catch((error) => { console.error(error); process.exit(1); });
