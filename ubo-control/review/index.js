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
const { cloneData, deepFreeze } = require("../internal/validation");
const UK_CORPORATE_REVIEW_POLICY_1_6_RC = deepFreeze(cloneData(require("../policies/uk-corporate/1.6-rc/policy.json")));

module.exports = Object.freeze({
  OWNERSHIP_GRAPH_PROJECTION_V2,
  UK_CORPORATE_REVIEW_POLICY_1_6_RC,
  UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
  UBO_REVIEW_ERROR_CODE,
  UboReviewError,
  createUboReviewApplication,
  projectOwnershipGraphV2,
});
