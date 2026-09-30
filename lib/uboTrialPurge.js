/* eslint-env node */
"use strict";

/**
 * Deletes the UBO trial workspaces of companies that did not buy, once
 * TRIAL_DELETE_AFTER_DAYS have passed since the trial ended (lib/uboRetention.js
 * says why this one kind of record is deleted rather than kept seven years).
 *
 * For each workspace that is due, in this order:
 *   1. plan the database purge (a dry run) to learn which uploaded files exist
 *   2. delete those files - if any fails, stop here for this workspace; it is
 *      still whole and tomorrow's run tries again. Deleting rows first would
 *      leave files with nothing pointing at them, undeletable for ever.
 *   3. delete the rows (db/tenantPurge.js, one transaction)
 *   4. delete the workspace's cached research and audit snapshots
 *   5. take away the person's access
 *   6. forget the person: trial record gone, email off the invite, one line
 *      kept to say the workspace existed and when it was deleted
 *
 * The database and the file store are handed in by the caller (the cron route),
 * so this module has no opinion about where they live.
 *
 * The report names workspaces only - never a person or a company - because it
 * goes to logs.
 */

const trials = require("./uboTrials");
const userAccess = require("./userAccess");
const { purgeTenant } = require("../db/tenantPurge");
const { forgetTenant } = require("../agents/ubo/uboPersistence");

const DEFAULT_DEPS = {
  trials,
  purgeTenant,
  forgetResearch: forgetTenant,
  revokeAccess: (userId) => userAccess.revokeAccess(userId),
};

async function runTrialPurge({ db, artifactStore, now = Date.now(), dryRun = false, deps = DEFAULT_DEPS }) {
  const due = await deps.trials.dueForDeletion(now);
  const report = { deleted: [], failed: [], planned: [] };

  for (const workspace of due) {
    const { tenantId } = workspace;
    try {
      const plan = await deps.purgeTenant(db, tenantId, { dryRun: true });
      if (dryRun) {
        report.planned.push({ tenantId, counts: plan.counts, files: plan.storageKeys.length });
        continue;
      }
      for (const key of plan.storageKeys) await artifactStore.delete(key);
      const done = await deps.purgeTenant(db, tenantId);
      const research = await deps.forgetResearch(tenantId);
      await deps.revokeAccess(workspace.userId);
      await deps.trials.forgetTrial(workspace, { deletedAt: new Date(now).toISOString() });
      report.deleted.push({ tenantId, counts: done.counts, sharedRemoved: done.sharedRemoved, files: plan.storageKeys.length, research });
    } catch (error) {
      report.failed.push({ tenantId, error: error.code || "purge_failed" });
    }
  }
  return report;
}

module.exports = { runTrialPurge };
