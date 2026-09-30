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
 *   2. count the attempt BEFORE starting, so a run the platform kills part-way
 *      still sends this workspace to the back of tomorrow's queue
 *   3. delete its rows - all or nothing (db/tenantPurge.js). If another
 *      workspace touches any of them, nothing is deleted: the workspace is
 *      reported BLOCKED and left for a person; it is not forgotten.
 *   4. just before that commit, add its files to the pending list, so a crash
 *      after the commit cannot lose track of files whose rows are gone
 *   5. delete those files - only a file no remaining row names; one that fails
 *      stays pending and every run retries it
 *   6. its cached research and audit snapshots
 *   7. every access record pointing at the workspace, and any pending email
 *      invitation to it
 *   8. forget the person: trial record gone, email off the invite, one line
 *      kept to say the workspace existed and when it was deleted
 *
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
const attemptsKey = (tenantId) => `ubo-trial-purge:failures:${tenantId}`;
// ponytail: leaves a minute of the route's five for the files and the reply.
const TIME_BUDGET_MS = 240 * 1000;

const DEFAULT_DEPS = {
  trials,
  purgeTenant,
  fileStillNamed,
  forgetResearch: forgetTenant,
  listAccess: (tenantId) => userAccess.listAccess(tenantId),
  revokeAccess: (userId) => userAccess.revokeAccess(userId),
  listPending: (tenantId) => userAccess.listPending(tenantId),
  cancelInvite: (email) => userAccess.cancelInvite(email),
  isProtectedTenant,
  storage,
};

const sameFile = (a) => (b) => a.provider === b.provider && a.key === b.key;

/** Deletes the files no row names any more; answers the ones still to do. */
async function deleteFiles(db, files, deps) {
  const remaining = [];
  for (const file of files) {
    try {
      if (await deps.fileStillNamed(db, file)) continue; // rows still use it - not ours to delete
      await deps.deleteFile(file);
    } catch (_) {
      remaining.push(file);
    }
  }
  return remaining;
}

/** @param deleteFile ({ provider, key }) => Promise - supplied by the caller,
 *  which knows where the files live (api/purge-trial-data.js). */
async function runTrialPurge({ db, deleteFile, now = Date.now(), dryRun = false, deps = { ...DEFAULT_DEPS, deleteFile } }) {
  if (process.env.UBO_TRIAL_PURGE_ENABLED !== "1") return { disabled: true, deleted: [], blocked: [], failed: [], planned: [] };
  const started = Date.now();
  const report = { deleted: [], blocked: [], failed: [], planned: [] };
  const readPending = async () => (await deps.storage.get(PENDING_FILES)) || [];

  // Files an earlier run could not delete.
  if (!dryRun) {
    const pending = await readPending();
    if (pending.length) await deps.storage.set(PENDING_FILES, await deleteFiles(db, pending, deps));
  }

  const due = await deps.trials.dueForDeletion(now);
  const attempts = new Map();
  for (const { tenantId } of due) attempts.set(tenantId, Number(await deps.storage.get(attemptsKey(tenantId))) || 0);
  due.sort((a, b) => attempts.get(a.tenantId) - attempts.get(b.tenantId));

  for (const workspace of due) {
    const { tenantId } = workspace;
    if (Date.now() - started > TIME_BUDGET_MS) break;
    if (!TRIAL_WORKSPACE.test(String(tenantId))) { report.failed.push({ tenantId, error: "not_a_trial_workspace" }); continue; }
    if (await deps.isProtectedTenant(tenantId)) { report.failed.push({ tenantId, error: "protected_workspace" }); continue; }

    if (dryRun) {
      const plan = await deps.purgeTenant(db, tenantId, { dryRun: true });
      report.planned.push({ tenantId, blocked: plan.blocked, touches: plan.touches, counts: plan.counts, files: plan.files.length });
      continue;
    }

    await deps.storage.set(attemptsKey(tenantId), attempts.get(tenantId) + 1);
    try {
      const done = await deps.purgeTenant(db, tenantId, {
        beforeCommit: async (files) => {
          const pending = await readPending();
          await deps.storage.set(PENDING_FILES, [...pending, ...files.filter((file) => !pending.some(sameFile(file)))]);
        },
      });
      if (done.blocked) {
        report.blocked.push({ tenantId, touches: done.touches });
        continue;
      }
      const leftover = await deleteFiles(db, done.files, deps);
      const pending = await readPending();
      await deps.storage.set(PENDING_FILES, pending.filter((file) => !done.files.some(sameFile(file)) || leftover.some(sameFile(file))));

      const research = await deps.forgetResearch(tenantId);
      for (const entry of await deps.listAccess(tenantId)) {
        if (entry.tenantId === tenantId) await deps.revokeAccess(entry.userId);
      }
      for (const invite of await deps.listPending(tenantId)) await deps.cancelInvite(invite.email);
      await deps.trials.forgetTrial(workspace, { deletedAt: new Date(now).toISOString() });
      await deps.storage.set(attemptsKey(tenantId), 0);
      report.deleted.push({ tenantId, counts: done.counts, sharedRemoved: done.sharedRemoved, files: done.files.length, research });
    } catch (error) {
      report.failed.push({ tenantId, error: error.code || "purge_failed" });
    }
  }

  report.pendingFiles = dryRun ? 0 : (await readPending()).length;
  return report;
}

module.exports = { runTrialPurge, TRIAL_WORKSPACE };
