"use strict";

const {
  UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
  UBO_REVIEW_ERROR_CODE,
  UboReviewError,
  createUboReviewApplication,
} = require("../application/createUboReviewApplication");
const {
  OWNERSHIP_GRAPH_PROJECTION_V2,
  projectOwnershipGraphV2,
} = require("../projection/ownershipGraphProjectionV2");
const {
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_WORK_BUNDLE_V2,
  CUSTOMER_WORK_DELEGATION_V1,
  CUSTOMER_WORK_STATE_V2,
  EXTERNAL_EVIDENCE_HANDOFF_V1,
  JOURNEY_PROJECTION_V2,
  SUBMISSION_CONTRACT,
  projectUboJourneyV2,
} = require("../projection/uboJourneyProjectionV2");
const {
  CUSTOMER_ACTION_RESULT_V2,
  CUSTOMER_ACTION_V2,
} = require("../application/applyCustomerInputV2");
const {
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  createUboDecisionApplication,
} = require("../application/createUboDecisionApplication");
const { cloneData, deepFreeze } = require("../internal/validation");
const UK_CORPORATE_REVIEW_POLICY_1_6_RC = deepFreeze(cloneData(require("../policies/uk-corporate/1.6-rc/policy.json")));

module.exports = Object.freeze({
  CUSTOMER_ACTION_RESULT_V2,
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_ACTION_V2,
  CUSTOMER_WORK_BUNDLE_V2,
  CUSTOMER_WORK_DELEGATION_V1,
  CUSTOMER_WORK_STATE_V2,
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  EXTERNAL_EVIDENCE_HANDOFF_V1,
  JOURNEY_PROJECTION_V2,
  OWNERSHIP_GRAPH_PROJECTION_V2,
  SUBMISSION_CONTRACT,
  UK_CORPORATE_REVIEW_POLICY_1_6_RC,
  UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
  UBO_REVIEW_ERROR_CODE,
  UboReviewError,
  createUboReviewApplication,
  createUboDecisionApplication,
  projectOwnershipGraphV2,
  projectUboJourneyV2,
});
