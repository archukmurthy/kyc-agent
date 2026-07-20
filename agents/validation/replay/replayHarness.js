async function replayValidation() {
  throw new Error("Historical replay is not implemented in Phase 1.");
}

var replayHarnessExported = {
  replayValidation,
};

if (typeof module !== "undefined") {
  module.exports = replayHarnessExported;
}

if (typeof window !== "undefined") {
  window.ValidationReplayHarness = replayHarnessExported;
}
