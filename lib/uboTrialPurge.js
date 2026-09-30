/* eslint-env node */
"use strict";

/**
 * Deletes the UBO trial workspaces of companies that did not buy, once
 * TRIAL_DELETE_AFTER_DAYS have passed since the trial ended (lib/uboRetention.js
 * says why this one kind of record is deleted rather than kept seven years).
 *
 * Switched off unless UBO_TRIAL_PURGE_ENABLED=1: only the UBO demo deployment
 * sets it, so the KYC platform - which shares this code - never runs it.
 *
 * For each workspace that is due, in this order:
 *   1. refuse unless the id is a trial workspace id and not protected
 *   2. delete its rows (db/tenantPurge.js, one transaction; rows others still
 *      use are kept)
 *   3. delete the uploaded files those rows named - only once the rows are
 *      gone, and only a file no remaining row names. A failure goes on a
 *      pending list every run retries; deleting files first, as the first
 *      version did, lost bytes other workspaces used when a delete was blocked.
 *   4. its cached research and audit snapshots
 *   5. the person's access, if it still points at this workspace, and any
 *      pending email invitation to it
 *   6. forget the person: trial record gone, email off the invite, one line
 *      kept to say the workspace existed and when it was deleted
 *
 * Workspaces that failed before go last, and no new one is started once the
 * time budget is spent, so one stuck workspace cannot starve the others.
 * The report names workspaces only - never a person or a company.
 */

const trials = require("./uboTrials");
const userAccess = require("./userAccess");
const storage = require("./storage");
const { isProtectedTenant } = require("./tenantRegistry");
const { purgeTenant, fileStillNamed } = require("../db/tenantPurge");
const { forgetTenant } = require("../agents/ubo/uboPersistence");

// Exactly what lib/uboTrials.js#workspaceFor produces: trial-<slug>-<8 hex>.
const TRIAL_WORKSPACE = /^trial-[a-z0-9]{1,12}-[0-9a-f]{8}$/;
const PENDING_FILES = "ubo-trial-purge:pending-files";
const failuresKey = (tenantId) => `ubo-trial-purge:failures:${tenantId}`;
// ponytail: leaves a minute of the route's five for the files and the reply.
const TIME_BUDGET_MS = 240 * 1000;

const DEFAULT_DEPS = {
  trials,
  purgeTenant,
  fileStillNamed,
  forgetResearch: forgetTenant,
  getAccess: (userId) => userAccess.getAccess(userId),
  revokeAccess: (userId) => userAccess.revokeAccess(userId),
  listPending: (tenantId) => userAccess.listPending(tenantId),
  cancelInvite: (email) => userAccess.cancelInvite(email),
  isProtectedTenant,
  storage,
};

async function deleteFiles(db, files, deps) {
  const failed = [];
  for (const file of files) {
    try {
      if (await deps.fileStillNamed(db, file)) continue;
      await deps.deleteFile(file);
    } catch (_) {
      failed.push(file);
    }
  }
  return failed;
}

/** @param deleteFile ({ provider, key }) => Promise - supplied by the caller,
 *  which knows where the files live (api/purge-trial-data.js). */
async function runTrialPurge({ db, deleteFile, now = Date.now(), dryRun = false, deps = { ...DEFAULT_DEPS, deleteFile } }) {
  if (process.env.UBO_TRIAL_PURGE_ENABLED !== "1") return { disabled: true, deleted: [], failed: [], planned: [] };
  const started = Date.now();
  const report = { deleted: [], failed: [], planned: [] };

  // Files a previous run could not delete.
  let pending = dryRun ? [] : (await deps.storage.get(PENDING_FILES)) || [];
  if (pending.length) pending = await deleteFiles(db, pending, deps);

  const due = await deps.trials.dueForDeletion(now);
  const failures = new Map();
  for (const { tenantId } of due) failures.set(tenantId, Number(await deps.storage.get(failuresKey(tenantId))) || 0);
  due.sort((a, b) => failures.get(a.tenantId) - failures.get(b.tenantId));

  for (const workspace of due) {
    const { tenantId } = workspace;
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (!TRIAL_WORKSPACE.test(String(tenantId))) { report.failed.push({ tenantId, error: "not_a_trial_workspace" }); continue; }
    if (await deps.isProtectedTenant(tenantId)) { report.failed.push({ tenantId, error: "protected_workspace" }); continue; }
    try {
      const done = await deps.purgeTenant(db, tenantId, { dryRun });
      if (dryRun) { report.planned.push({ tenantId, counts: done.counts, kept: done.kept, files: done.files.length }); continue; }
      pending.push(...(await deleteFiles(db, done.files, deps)));
      const research = await deps.forgetResearch(tenantId);
      const access = await deps.getAccess(workspace.userId);
      if (access && access.tenantId === tenantId) await deps.revokeAccess(workspace.userId);
      for (const invite of await deps.listPending(tenantId)) await deps.cancelInvite(invite.email);
      await deps.trials.forgetTrial(workspace, { deletedAt: new Date(now).toISOString() });
      report.deleted.push({ tenantId, counts: done.counts, kept: done.kept, sharedRemoved: done.sharedRemoved, files: done.files.length, research });
    } catch (error) {
      await deps.storage.set(failuresKey(tenantId), failures.get(tenantId) + 1);
      report.failed.push({ tenantId, error: error.code || "purge_failed" });
    }
  }

  if (!dryRun) await deps.storage.set(PENDING_FILES, pending);
  report.pendingFiles = pending.length;
  return report;
}

module.exports = { runTrialPurge, TRIAL_WORKSPACE };
