"use strict";

const PLATFORM_STATUS = Object.freeze({
  platform: "evidence",
  stage: "A0",
  status: "available",
});

function getPlatformStatus() {
  return { ...PLATFORM_STATUS };
}

module.exports = { getPlatformStatus };
