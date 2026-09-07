"use strict";

function firstOf(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : {};
}

function mapDecision(payload) {
  const d = (payload && payload.decision) || payload || {};
  const status = d.status || (payload && payload.status) || "Unknown";
  const verified = String(status).toUpperCase() === "APPROVED";

  const idv = firstOf(d.id_verifications || d.id_verification);
  const mappedFields = {};
  if (idv.first_name) mappedFields.applicantFirstName = idv.first_name;
  if (idv.last_name) mappedFields.applicantLastName = idv.last_name;
  if (idv.date_of_birth) mappedFields.applicantDateOfBirth = idv.date_of_birth;
  if (idv.nationality) mappedFields.applicantNationality = idv.nationality;

  const liveness = firstOf(d.liveness_checks || d.liveness);
  const faceMatch = firstOf(d.face_matches || d.face_match);

  const extras = {
    documentType: idv.document_type || null,
    documentNumber: idv.document_number || null,
    expirationDate: idv.expiration_date || idv.expiry_date || null,
    dateOfIssue: idv.date_of_issue || null,
    issuingState: idv.issuing_state || idv.issuing_country || null,
    gender: idv.gender || null,
    placeOfBirth: idv.place_of_birth || null,
    address:
      (idv.parsed_address && (idv.parsed_address.full || idv.parsed_address)) ||
      idv.formatted_address || idv.address || null,
    livenessStatus: liveness.status || null,
    faceMatchStatus: faceMatch.status || null,
    diditStatus: status,
  };

  return { status, verified, mappedFields, extras };
}

module.exports = { mapDecision };
