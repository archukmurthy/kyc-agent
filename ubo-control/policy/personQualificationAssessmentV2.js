"use strict";

const {
  QUALIFICATION_ASSESSMENT_STATE,
  QUALIFICATION_CLASSIFICATION,
  QUALIFICATION_ROUTE,
} = require("../domain/qualificationBasisV2");
const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const PERSON_QUALIFICATION_ASSESSMENT_VERSION = "ubo-person-qualification-assessment-v2";
const PERSON_ROUTE_STATUS = Object.freeze({
  ROUTE_SATISFIED: "ROUTE_SATISFIED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  INDETERMINATE: "INDETERMINATE",
  NOT_SATISFIED: "NOT_SATISFIED",
});

function unique(values) { return [...new Set(values || [])].sort(); }

function assessPersonQualificationV2({ personEntityId, targetEntityId, basisRecords, explicitlyMaterialRoutes = [] }) {
  const records = (basisRecords || []).filter((basis) => basis.personEntityId === personEntityId && basis.targetEntityId === targetEntityId);
  if (records.some((basis) => !basis.basisId || !basis.route || !basis.classification || !basis.assessmentState)) {
    fail("person qualification requires valid QualificationBasis v2 records");
  }
  const statutory = records.filter(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.STATUTORY);
  const firm = records.filter(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.FIRM_POLICY);
  const assessedRoutes = unique(records.map(({ route }) => route));
  const declaredRoutes = Object.values(QUALIFICATION_ROUTE);
  const unassessedRoutes = unique([...declaredRoutes.filter((route) => !assessedRoutes.includes(route)), ...explicitlyMaterialRoutes.filter((route) => !assessedRoutes.includes(route))]);
  const materialManagementUnassessed = unassessedRoutes.includes(QUALIFICATION_ROUTE.MANAGEMENT_CONTROL);
  let routeStatus;
  let reasonCode;
  if (statutory.some(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.SATISFIED)) {
    routeStatus = PERSON_ROUTE_STATUS.ROUTE_SATISFIED;
    reasonCode = "AT_LEAST_ONE_STATUTORY_ROUTE_SATISFIED";
  } else if (statutory.some(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED)) {
    routeStatus = PERSON_ROUTE_STATUS.REVIEW_REQUIRED;
    reasonCode = "MATERIAL_STATUTORY_ROUTE_REQUIRES_HUMAN_INTERPRETATION";
  } else if (statutory.some(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE)
    || unassessedRoutes.length > 0 || materialManagementUnassessed) {
    routeStatus = PERSON_ROUTE_STATUS.INDETERMINATE;
    reasonCode = materialManagementUnassessed
      ? "MANAGEMENT_CONTROL_ROUTE_MATERIALLY_UNASSESSED"
      : "STATUTORY_ROUTE_INDETERMINATE_OR_UNASSESSED";
  } else {
    routeStatus = PERSON_ROUTE_STATUS.NOT_SATISFIED;
    reasonCode = "ALL_APPLICABLE_STATUTORY_ROUTES_DEFINITIVELY_NOT_SATISFIED";
  }
  const requiredSignoffIds = unique(records.flatMap((basis) => [
    ...(basis.reviewDependencies || []), ...(basis.governance?.requiredSignoffIds || []),
  ]));
  const semantic = {
    assessmentSchemaVersion: PERSON_QUALIFICATION_ASSESSMENT_VERSION,
    personEntityId,
    targetEntityId,
    basisIds: records.map(({ basisId }) => basisId).sort(),
    routeStatus,
    reasonCode,
    assessedRoutes,
    unassessedRoutes,
  };
  return deepFreeze(cloneData({
    ...semantic,
    assessmentId: `${PERSON_QUALIFICATION_ASSESSMENT_VERSION}:${hashArtifact(semantic).slice(7, 39)}`,
    basisRecords: records.map(cloneData).sort((a, b) => a.basisId.localeCompare(b.basisId)),
    statutoryBasisIds: statutory.map(({ basisId }) => basisId).sort(),
    firmPolicyBasisIds: firm.map(({ basisId }) => basisId).sort(),
    satisfiedBasisIds: records.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.SATISFIED).map(({ basisId }) => basisId).sort(),
    indeterminateBasisIds: records.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE).map(({ basisId }) => basisId).sort(),
    reviewRequiredBasisIds: records.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.REVIEW_REQUIRED).map(({ basisId }) => basisId).sort(),
    notSatisfiedBasisIds: records.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED).map(({ basisId }) => basisId).sort(),
    firmPolicyOnlySatisfied: routeStatus !== PERSON_ROUTE_STATUS.ROUTE_SATISFIED
      && firm.some(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.SATISFIED),
    governance: { governanceState: "REVIEW_ONLY", productionAuthorized: false, requiredSignoffIds },
  }));
}

module.exports = { PERSON_QUALIFICATION_ASSESSMENT_VERSION, PERSON_ROUTE_STATUS, assessPersonQualificationV2 };
