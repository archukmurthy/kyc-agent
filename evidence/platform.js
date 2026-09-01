"use strict";

const PLATFORM_STATUS = Object.freeze({
  platform: "evidence",
  stage: "R2",
  status: "available",
});

function getPlatformStatus() {
  return { ...PLATFORM_STATUS };
}

module.exports = { getPlatformStatus };
