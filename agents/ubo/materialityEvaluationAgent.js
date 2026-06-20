"use strict";

function maximumPossibleOwnership(pathPercentage, nextPercentage) {
  if (!Number.isFinite(pathPercentage) || !Number.isFinite(nextPercentage)) return 100;
  return (pathPercentage * nextPercentage) / 100;
}

function evaluateMateriality({ pathPercentage = 100, nextOwnershipPercentage, discoveryThreshold = 5 }) {
  const maximum = maximumPossibleOwnership(pathPercentage, nextOwnershipPercentage);
  return {
    maximumPossibleOwnership: maximum,
    material: maximum >= discoveryThreshold,
    reason: maximum >= discoveryThreshold
      ? `Potential effective ownership (${maximum}%) meets the ${discoveryThreshold}% discovery threshold.`
      : `Potential effective ownership (${maximum}%) is below the ${discoveryThreshold}% discovery threshold.`,
  };
}

module.exports = { evaluateMateriality, maximumPossibleOwnership };
