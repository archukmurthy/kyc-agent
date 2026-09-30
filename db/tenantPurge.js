"use strict";

/**
 * Deletes every row a workspace (tenant) owns, for real, in one transaction.
 *
 * Why this exists: a UBO trial's data is deleted 90 days after the trial ends
 * if the company did not buy (owner decision, 2026-09-30). For trial data that
 * overrides the "never hard-delete" rule in lib/uboRetention.js; customers keep
 * the seven-year rule.
 *
 * Why it reads the schema instead of listing tables: the UBO and Evidence
 * tables hold 89 foreign keys and none of them cascade, and most Evidence rows
 * belong to a workspace only through a chain of them - no tenant_id of their
 * own. A hand-written list of tables would be wrong the day somebody adds one.
 * So this walks the database's own foreign keys:
 *
 *   1. Mark every row with tenant_id = the workspace.
 *   2. Mark, repeatedly until nothing new is found, every row whose foreign key
 *      points at a marked row. A row that has its own tenant_id is only marked
 *      if it is this workspace's; another workspace's row pointing here makes
 *      the delete fail on its foreign key, and the whole thing rolls back -
 *      loud, never a silent loss of someone else's data.
 *   3. Note the rows marked rows point UP at that have no tenant of their own
 *      (Evidence's company records, collection operations). Those can be
 *      shared between workspaces, so they are deleted only if, once the
 *      workspace is gone, nothing references them any more.
 *   4. Delete children before parents, then the unshared parents, then the
 *      tenants row itself.
 *
 * Returns what was (or, on a dry run, would be) deleted per table, and the
 * storage keys of uploaded files, whose bytes live outside the database and
 * must be deleted by the caller.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/;
function q(identifier) {
  if (!IDENT.test(identifier)) throw new Error(`unexpected identifier ${identifier}`);
  return `"${identifier}"`;
}
const cols = (alias, names) => `(${names.map((n) => `${alias}.${q(n)}`).join(", ")})`;

class DryRun extends Error {}

async function foreignKeys(client) {
  const result = await client.query(`
    SELECT cl.relname AS child, pcl.relname AS parent,
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS child_cols,
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(n, ord)
         JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n) AS parent_cols
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pcl ON pcl.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'`);
  return result.rows.map((r) => ({ child: r.child, parent: r.parent, childCols: r.child_cols, parentCols: r.parent_cols }));
}

async function tablesWithColumn(client, column) {
  const result = await client.query(
    "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = $1",
    [column],
  );
  return new Set(result.rows.map((r) => r.table_name));
}

/** Children before parents, over the tables that matter. Self-references are
 *  ignored for ordering; a real cycle is refused rather than guessed at. */
function deleteOrder(tables, fks) {
  const pending = new Set(tables);
  const order = [];
  while (pending.size) {
    const ready = [...pending].filter((t) => !fks.some((fk) => fk.parent === t && fk.child !== t && pending.has(fk.child)));
    if (!ready.length) throw new Error(`foreign keys form a cycle between: ${[...pending].join(", ")}`);
    for (const t of ready.sort()) { order.push(t); pending.delete(t); }
  }
  return order;
}

async function markRows(client, tenantId, fks, tenantTables) {
  await client.query("CREATE TEMP TABLE purge_marks (tbl text NOT NULL, rid tid NOT NULL, PRIMARY KEY (tbl, rid)) ON COMMIT DROP");
  await client.query("CREATE TEMP TABLE purge_shared (tbl text NOT NULL, rid tid NOT NULL, PRIMARY KEY (tbl, rid)) ON COMMIT DROP");

  for (const table of tenantTables) {
    await client.query(`INSERT INTO purge_marks SELECT '${table}', ctid FROM ${q(table)} WHERE tenant_id = $1 ON CONFLICT DO NOTHING`, [tenantId]);
  }

  const down = fks.filter((fk) => fk.parent !== "tenants" && fk.child !== fk.parent);
  for (let added = 1; added > 0;) {
    added = 0;
    for (const fk of down) {
      const ownOnly = tenantTables.has(fk.child) ? "AND c.tenant_id = $1" : "";
      const result = await client.query(`
        INSERT INTO purge_marks
        SELECT '${fk.child}', c.ctid FROM ${q(fk.child)} c
        WHERE ${cols("c", fk.childCols)} IN (
          SELECT ${fk.parentCols.map((n) => `p.${q(n)}`).join(", ")} FROM ${q(fk.parent)} p
          JOIN purge_marks m ON m.tbl = '${fk.parent}' AND m.rid = p.ctid)
        ${ownOnly}
        ON CONFLICT DO NOTHING`, ownOnly ? [tenantId] : []);
      added += result.rowCount || 0;
    }
  }

  // Rows the marked rows point UP at that belong to no workspace themselves.
  const up = fks.filter((fk) => fk.parent !== "tenants" && fk.child !== fk.parent && !tenantTables.has(fk.parent));
  for (let added = 1; added > 0;) {
    added = 0;
    for (const fk of up) {
      const result = await client.query(`
        INSERT INTO purge_shared
        SELECT '${fk.parent}', p.ctid FROM ${q(fk.parent)} p
        WHERE ${cols("p", fk.parentCols)} IN (
          SELECT ${fk.childCols.map((n) => `c.${q(n)}`).join(", ")} FROM ${q(fk.child)} c
          WHERE c.ctid IN (SELECT rid FROM purge_marks WHERE tbl = '${fk.child}')
             OR c.ctid IN (SELECT rid FROM purge_shared WHERE tbl = '${fk.child}'))
          AND p.ctid NOT IN (SELECT rid FROM purge_marks WHERE tbl = '${fk.parent}')
        ON CONFLICT DO NOTHING`);
      added += result.rowCount || 0;
    }
  }
}

/** A row nothing references any more - the test for deleting a shared one. */
function unreferenced(table, fks) {
  return fks
    .filter((fk) => fk.parent === table)
    .map((fk) => `NOT EXISTS (SELECT 1 FROM ${q(fk.child)} c WHERE ${cols("c", fk.childCols)} = ${cols("t", fk.parentCols)})`)
    .join(" AND ") || "TRUE";
}

async function purgeTenant(db, tenantId, { dryRun = false } = {}) {
  if (!tenantId) throw new Error("purgeTenant needs a tenant");
  let outcome;
  try {
    await db.transaction(async (client) => {
      const fks = await foreignKeys(client);
      const tenantTables = await tablesWithColumn(client, "tenant_id");
      tenantTables.delete("tenants");
      await markRows(client, tenantId, fks, tenantTables);

      const counts = {};
      for (const row of (await client.query("SELECT tbl, count(*)::int AS n FROM purge_marks GROUP BY tbl")).rows) counts[row.tbl] = row.n;

      const storageKeys = [];
      for (const table of await tablesWithColumn(client, "storage_key")) {
        if (!counts[table]) continue;
        const keys = await client.query(`SELECT t.storage_key FROM ${q(table)} t
          WHERE t.ctid IN (SELECT rid FROM purge_marks WHERE tbl = '${table}') AND t.storage_key IS NOT NULL`);
        storageKeys.push(...keys.rows.map((r) => r.storage_key));
      }

      const shared = {};
      if (!dryRun) {
        for (const table of deleteOrder(Object.keys(counts), fks)) {
          await client.query(`DELETE FROM ${q(table)} WHERE ctid IN (SELECT rid FROM purge_marks WHERE tbl = '${table}')`);
        }
        const sharedTables = (await client.query("SELECT DISTINCT tbl FROM purge_shared")).rows.map((r) => r.tbl);
        for (const table of deleteOrder(sharedTables, fks)) {
          const removed = await client.query(`DELETE FROM ${q(table)} t
            WHERE t.ctid IN (SELECT rid FROM purge_shared WHERE tbl = '${table}') AND ${unreferenced(table, fks)}`);
          if (removed.rowCount) shared[table] = removed.rowCount;
        }
        // The workspace itself, unless something outside this purge still
        // points at it (on the platform database, KYC rows would).
        await client.query(`DELETE FROM tenants t WHERE t.id = $1 AND ${unreferenced("tenants", fks)}`, [tenantId]);
      }

      outcome = { tenantId, dryRun, counts, sharedRemoved: shared, storageKeys };
      if (dryRun) throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  return outcome;
}

module.exports = { purgeTenant, deleteOrder };
