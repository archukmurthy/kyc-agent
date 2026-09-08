"use strict";

// Feature flag for the entire Identity Discrepancy Bands feature.
// Default OFF: when disabled, the journey behaves exactly as it does today.
function bandsEnabled() {
  const v = String(process.env.IDV_DISCREPANCY_BANDS_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

module.exports = { bandsEnabled };
