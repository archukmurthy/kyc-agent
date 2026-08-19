"use strict";

const PLATFORM_STATUS = Object.freeze({
  platform: "evidence",
  stage: "A3",
  status: "available",
});

function getPlatformStatus() {
  return { ...PLATFORM_STATUS };
}

module.exports = { getPlatformStatus };
