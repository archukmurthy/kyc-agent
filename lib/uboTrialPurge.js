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
 *   4. just before that commit, record each of its files as pending, so a
 *      crash after the commit cannot lose track of files whose rows are gone
 *   5. delete those files - only a file no remaining row names; one that fails
 *      stays pending and every run retries it
 *   6. its cached research and audit snapshots
 *   7. every access record pointing at the workspace, and any pending email
 *      invitation to it
 *   8. forget the person: trial record gone, email off the invite, one line
 *      kept to say the workspace existed and when it was deleted
 *
 * Each pending file is its own storage key. A single shared list was read,
 * changed and written back, and two overlapping runs lost each other's files
 * (reproduced in review) - an uploaded chart left with no rows and on no list.
 *
 * The report names workspaces only - never a person or a company.
 */

const crypto = require("node:crypto");
const trials = require("./uboTrials");
const userAccess = require("./userAccess");
const storage = require("./storage");
const { isProtectedTenant } = require("./tenantRegistry");
const { purgeTenant, fileStillNamed } = require("../db/tenantPurge");
const { forgetTenant } = require("../agents/ubo/uboPersistence");

// Exactly what lib/uboTrials.js#workspaceFor produces: trial-<slug>-<8 hex>.
const TRIAL_WORKSPACE = /^trial-[a-z0-9]{1,12}-[0-9a-f]{8}$/;
const PENDING_PREFIX = "ubo-trial-purge:pending:";
const attemptsKey = (tenantId) => `ubo-trial-purge:failures:${tenantId}`;
// ponytail: leaves a minute of the route's five for the files and the reply.
const TIME_BUDGET_MS = 240 * 1000;
// Longer than any run lives (the route's limit is five minutes): a pending
// file younger than this may belong to a run still in its transaction.
const SETTLE_AFTER_MS = 10 * 60 * 1000;

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

// Readable for a short key, hashed for anything else, so any storage key is valid.
function pendingKey({ provider, key }) {
  const raw = `${provider}:${key}`;
  return PENDING_PREFIX + (/^[\w./:-]{1,200}$/.test(raw) ? raw : crypto.createHash("sha256").update(raw).digest("hex"));
}

/** Deletes a file if no row names it any more, and takes it off the pending
 *  list once it is gone - or once rows still name it, when it is not ours. */
async function settleFile(db, file, deps) {
  try {
    if (!(await deps.fileStillNamed(db, file))) await deps.deleteFile(file);
    await deps.storage.del(pendingKey(file));
    return true;
  } catch (_) {
    return false; // stays pending; the next run tries again
  }
}

/** @param deleteFile ({ provider, key }) => Promise - supplied by the caller,
 *  which knows where the files live (api/purge-trial-data.js). */
async function runTrialPurge({ db, deleteFile, now = Date.now(), dryRun = false, deps = { ...DEFAULT_DEPS, deleteFile } }) {
  if (process.env.UBO_TRIAL_PURGE_ENABLED !== "1") return { disabled: true, deleted: [], blocked: [], failed: [], planned: [] };
  const started = Date.now();
  const overBudget = () => Date.now() - started > TIME_BUDGET_MS;
  const report = { deleted: [], blocked: [], failed: [], planned: [] };

  // Files an earlier run could not delete.
  if (!dryRun) {
    for (const key of await deps.storage.list(PENDING_PREFIX)) {
      if (overBudget()) break;
      const file = await deps.storage.get(key);
      // Recorded moments ago by a run that may not have committed yet: its rows
      // still name the file, and settling it now would drop the record that
      // run relies on (review). That run, or a later one, settles it.
      if (!file || (file.recordedAt && Date.now() - file.recordedAt < SETTLE_AFTER_MS)) continue;
      await settleFile(db, file, deps);
    }
  }

  const due = await deps.trials.dueForDeletion(now);
  const attempts = new Map();
  for (const { tenantId } of due) attempts.set(tenantId, Number(await deps.storage.get(attemptsKey(tenantId))) || 0);
  due.sort((a, b) => attempts.get(a.tenantId) - attempts.get(b.tenantId));

  for (const workspace of due) {
    const { tenantId } = workspace;
    if (overBudget()) break;
    if (!TRIAL_WORKSPACE.test(String(tenantId))) { report.failed.push({ tenantId, error: "not_a_trial_workspace" }); continue; }
    try {
      if (await deps.isProtectedTenant(tenantId)) { report.failed.push({ tenantId, error: "protected_workspace" }); continue; }

      if (dryRun) {
        const plan = await deps.purgeTenant(db, tenantId, { dryRun: true });
        report.planned.push({ tenantId, blocked: plan.blocked, touches: plan.touches, counts: plan.counts, files: plan.files.length });
        continue;
      }

      await deps.storage.set(attemptsKey(tenantId), attempts.get(tenantId) + 1);
      const done = await deps.purgeTenant(db, tenantId, {
        beforeCommit: async (files) => {
          for (const file of files) await deps.storage.set(pendingKey(file), { ...file, recordedAt: Date.now() });
        },
      });
      if (done.blocked) {
        report.blocked.push({ tenantId, touches: done.touches });
        continue;
      }
      let filesLeft = 0;
      for (const file of done.files) if (!(await settleFile(db, file, deps))) filesLeft += 1;

      const research = await deps.forgetResearch(tenantId);
      for (const entry of await deps.listAccess(tenantId)) {
        if (entry.tenantId === tenantId) await deps.revokeAccess(entry.userId);
      }
      for (const invite of await deps.listPending(tenantId)) await deps.cancelInvite(invite.email);
      await deps.trials.forgetTrial(workspace, { deletedAt: new Date(now).toISOString() });
      await deps.storage.del(attemptsKey(tenantId));
      report.deleted.push({ tenantId, counts: done.counts, sharedRemoved: done.sharedRemoved, files: done.files.length, filesLeft, research });
    } catch (error) {
      report.failed.push({ tenantId, error: error.code || "purge_failed" });
    }
  }

  report.pendingFiles = dryRun ? 0 : (await deps.storage.list(PENDING_PREFIX)).length;
  return report;
}

module.exports = { runTrialPurge, TRIAL_WORKSPACE };
