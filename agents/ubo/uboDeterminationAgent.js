"use strict";

function determineUbos({ ownership, control = [], rules = {} }) {
  const threshold = Number(rules.uboThreshold || 25);
  const ubos = ownership.individuals
    .filter((person) => person.effectiveOwnership >= threshold)
    .map((person) => ({ name: person.name, personId: person.individualId, ownership: person.effectiveOwnership, basis: "ownership", chains: person.chains }));
  if (rules.includeControl !== false) {
    for (const item of control) {
      const existing = ubos.find((ubo) => ubo.personId === item.personId);
      if (existing) {
        existing.basis = "ownership_and_control";
        existing.control = existing.control || [];
        existing.control.push(item);
      } else {
        ubos.push({ name: item.person, personId: item.personId, ownership: null, basis: "control", control: [item] });
      }
    }
  }
  return { ubos, threshold };
}

module.exports = { determineUbos };
