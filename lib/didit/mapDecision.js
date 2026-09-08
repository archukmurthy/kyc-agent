"use strict";

const { toAlpha2 } = require("./iso3to2");

function firstOf(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : {};
}

// MRZ / document names are commonly ALL CAPS ("MARIA VICTORIA"); banks often
// expect proper case. The user can still edit in the IDV step.
function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

function mapDecision(payload) {
  const d = (payload && payload.decision) || payload || {};
  const status = d.status || (payload && payload.status) || "Unknown";
  const verified = String(status).toUpperCase() === "APPROVED";

  const idv = firstOf(d.id_verifications || d.id_verification);
  const mappedFields = {};
  if (idv.first_name) mappedFields.applicantFirstName = titleCase(idv.first_name);
  if (idv.last_name) mappedFields.applicantLastName = titleCase(idv.last_name);
  if (idv.date_of_birth) mappedFields.applicantDateOfBirth = idv.date_of_birth;
  if (idv.nationality) mappedFields.applicantNationality = toAlpha2(idv.nationality);

  const liveness = firstOf(d.liveness_checks || d.liveness);
  const faceMatch = firstOf(d.face_matches || d.face_match);

  // P3: flag an expired document so the UI can block/warn.
  const expiry = idv.expiration_date || idv.expiry_date || null;
  const documentExpired = expiry ? Date.parse(expiry) < Date.now() : false;

  // P6: AML/PEP screening — surface a hit so it can feed applicantIsPEP.
  const amlRaw = d.aml_screenings || d.aml_screening || [];
  const amlArr = Array.isArray(amlRaw) ? amlRaw : [amlRaw];
  const amlTotalHits = amlArr.reduce((n, s) => n + (Number(s && s.total_hits) || 0), 0);
  const amlHit = amlArr.some(
    (s) => (Number(s && s.total_hits) || 0) > 0 ||
      String((s && s.status) || "").toUpperCase() === "DECLINED"
  );

  const extras = {
    documentType: idv.document_type || null,
    documentNumber: idv.document_number || null,
    expirationDate: expiry,
    dateOfIssue: idv.date_of_issue || null,
    issuingState: idv.issuing_state || idv.issuing_country || null,
    gender: idv.gender || null,
    placeOfBirth: idv.place_of_birth || null,
    address:
      (idv.parsed_address && (idv.parsed_address.full || idv.parsed_address)) ||
      idv.formatted_address || idv.address || null,
    // MRZ is the checksummed, more-reliable name source used by the discrepancy
    // matcher (Phase 4). It is document-extracted data for server-side matching
    // only and is never surfaced in the applicant UI (object-valued extras are
    // not rendered as cells).
    mrz: idv.mrz || null,
    livenessStatus: liveness.status || null,
    faceMatchStatus: faceMatch.status || null,
    diditStatus: status,
    documentExpired,
    amlHit,
    amlTotalHits,
  };

  return { status, verified, mappedFields, extras };
}

module.exports = { mapDecision };
