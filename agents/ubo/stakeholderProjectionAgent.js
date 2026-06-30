"use strict";

function projectStakeholders({ determination, control = [] }) {
  const byId = new Map();
  for (const ubo of determination.ubos || []) {
    byId.set(ubo.personId, { id: ubo.personId, name: ubo.name, roles: ["ubo"], effectiveOwnership: ubo.ownership, basis: ubo.basis, confidence: 100 });
  }
  for (const item of control) {
    const existing = byId.get(item.personId) || { id: item.personId, name: item.person, roles: [], effectiveOwnership: null, basis: "control", confidence: item.confidence || 0 };
    if (!existing.roles.includes("controller")) existing.roles.push("controller");
    byId.set(item.personId, existing);
  }
  return [...byId.values()];
}

module.exports = { projectStakeholders };
