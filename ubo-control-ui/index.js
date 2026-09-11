"use strict";

module.exports = Object.freeze({
  ...require("./OwnershipGraph"),
  ...require("./UboJourney"),
  UboApplicantJourneyV2: require("./UboApplicantJourneyV2").UboApplicantJourneyV2,
});
