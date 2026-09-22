"use strict";

// The workspace an Evidence Lab call belongs to.
//
// Every route here used to end its lookup with `|| "nium"` - so a call that
// named no workspace was silently filed under one particular company. That is
// a leak wearing the clothes of a convenience: the data goes somewhere, it is
// just somewhere wrong.
//
// This refuses instead. The lab is a local tool; setting EVIDENCE_LAB_TENANT_ID
// is one line in .env.local, and an error that says so is better than a
// misfiled row nobody notices.
function evidenceLabTenantId() {
  const named = (process.env.EVIDENCE_LAB_TENANT_ID || process.env.TENANT_ID || "").trim();
  if (!named) {
    const error = new Error("EVIDENCE_LAB_TENANT_ID is not set - the Evidence Lab needs a workspace to file work under");
    error.statusCode = 500;
    error.code = "evidence_lab_tenant_required";
    throw error;
  }
  return named;
}

module.exports = { evidenceLabTenantId };
