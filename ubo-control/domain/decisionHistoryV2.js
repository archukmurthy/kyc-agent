"use strict";

const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { DECISION_SNAPSHOT_SCHEMA_VERSION, reconstructDecisionState, verifyDecisionSnapshot } = require("./decisionSnapshot");
const { DECISION_SNAPSHOT_V2, reconstructDecisionStateV2, verifyDecisionSnapshotV2 } = require("./decisionSnapshotV2");

const DECISION_HISTORY_V2 = "ubo-decision-history-v2";

function verifyAny(snapshot) {
  if (snapshot.snapshotSchemaVersion === DECISION_SNAPSHOT_SCHEMA_VERSION) return verifyDecisionSnapshot(snapshot);
  if (snapshot.snapshotSchemaVersion === DECISION_SNAPSHOT_V2) return verifyDecisionSnapshotV2(snapshot);
  fail("unsupported DecisionSnapshot version");
}
function reconstructAny(snapshot) {
  return snapshot.snapshotSchemaVersion === DECISION_SNAPSHOT_SCHEMA_VERSION
    ? reconstructDecisionState(snapshot) : reconstructDecisionStateV2(snapshot);
}
function createDecisionHistoryV2(caseId, snapshots = []) {
  const history = { historyModelVersion: DECISION_HISTORY_V2, caseId, snapshots: snapshots.map(cloneData) };
  verifyDecisionHistoryV2(history);
  return deepFreeze(history);
}
function priorRef(snapshot) {
  return snapshot.decisionContent.history.previousSnapshot;
}
function verifyDecisionHistoryV2(history) {
  if (!history || history.historyModelVersion !== DECISION_HISTORY_V2 || !Array.isArray(history.snapshots)) fail("invalid DecisionHistory v2");
  history.snapshots.forEach((snapshot, index) => {
    verifyAny(snapshot);
    if (snapshot.decisionContent.caseReference.caseId !== history.caseId) fail("DecisionHistory v2 contains another case");
    const prior = index === 0 ? null : history.snapshots[index - 1];
    const reference = priorRef(snapshot);
    if (!prior && reference !== null) fail("DecisionHistory v2 genesis has a predecessor");
    if (prior && (!reference || reference.snapshotId !== prior.snapshotId || reference.decisionContentHash !== prior.decisionContentHash)) fail("DecisionHistory v2 is not linear");
  });
  return true;
}
function appendDecisionSnapshotV2(history, snapshot, { expectedHeadSnapshotId = null } = {}) {
  verifyDecisionHistoryV2(history); verifyAny(snapshot);
  const head = history.snapshots.at(-1) || null;
  if ((head?.snapshotId || null) !== expectedHeadSnapshotId) fail("stale DecisionHistory v2 head", "STALE_DECISION_HISTORY_HEAD");
  const next = { ...history, snapshots: [...history.snapshots, cloneData(snapshot)] };
  verifyDecisionHistoryV2(next);
  return deepFreeze(next);
}

module.exports = { DECISION_HISTORY_V2, appendDecisionSnapshotV2, createDecisionHistoryV2, reconstructAny, verifyAny, verifyDecisionHistoryV2 };
