"use strict";

/**
 * Deletes the rows a workspace (tenant) owns and nobody else needs, for real,
 * in one transaction.
 *
 * Why: a UBO trial by a company that did not buy is deleted 90 days after it
 * ends (owner decision, 2026-09-30; the exception to "never hard-delete" is in
 * lib/uboRetention.js). Customers keep the seven-year rule.
 *
 * Why it reads the schema: 89 foreign keys, none cascading, and most Evidence
 * rows have no tenant_id - they belong to a workspace through chains of keys.
 * A hand-written table list would be wrong the day a table is added.
 *
 * THE RULE: ALL OR NOTHING. Two adversarial reviews showed that "delete my
 * part, keep what others use" cannot be done safely here: a row with no
 * tenant_id is not necessarily this workspace's (Evidence shares public data
 * between workspaces), and keeping a shared row while deleting what hangs
 * below it still guts it. Ownership is not written down, so it is not guessed:
 *
 *   MINE   = rows with tenant_id = this workspace, and every row reachable
 *            from them by foreign keys downward, never crossing into a row
 *            that has another tenant_id.
 *   OTHERS = the same walk from every other workspace's rows.
 *
 * If ANY other workspace touches MINE - a row in both walks, a row outside
 * MINE whose foreign key points into it, or a sealed evidence package naming
 * a row of it (by "<type>:<id>" text, no foreign key) - NOTHING is deleted
 * and the result says blocked, with the reasons, for a person to look at. In
 * the demo's own flow a workspace's Evidence rows come from its private chart
 * uploads, which no other workspace can use, so blocked should be rare - and
 * when it happens it is seen, not silently half-done.
 *
 * Otherwise every row of MINE goes, then the rows of the two shared-by-design
 * tables (SHARED_TABLES) that nothing references any more, then the tenants
 * row.
 *
 * Runs at REPEATABLE READ, so every statement sees one snapshot: row addresses
 * (ctid) cannot be recycled under it, and a concurrent change to a row being
 * deleted fails the transaction instead of deleting something else.
 *
 * Returns blocked (with how others touch it) or what was (on a dry run, would
 * be) deleted per table, and the uploaded files - { provider, key } - whose
 * bytes live outside the database. The caller deletes those AFTER this commits,
 * and only if no row still names them.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/;
function q(identifier) {
  if (!IDENT.test(identifier)) throw new Error(`unexpected identifier ${identifier}`);
  return `"${identifier}"`;
}
const cols = (alias, names) => `(${names.map((n) => `${alias}.${q(n)}`).join(", ")})`;

// Owned by no workspace: one row per real-world company / collection, reused by
// every workspace that looks at it.
const SHARED_TABLES = ["evidence_subject_references", "evidence_collection_operations"];

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

/** Children before parents. Self-references do not order; a real cycle is refused. */
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

/** Marks, under `tag`, the rows owned by the seed condition and everything
 *  below them, never crossing into a row whose own tenant_id fails `guard`. */
async function walkDown(client, { tag, seed, guard, params, fks, tenantTables }) {
  let fresh = new Set();
  for (const table of tenantTables) {
    const result = await client.query(`INSERT INTO purge_marks SELECT '${tag}', '${table}', ctid FROM ${q(table)} WHERE ${seed} ON CONFLICT DO NOTHING`, params);
    if (result.rowCount) fresh.add(table);
  }
  const down = fks.filter((fk) => fk.parent !== "tenants");
  // One statement per pass (the database is a network hop away; one per
  // foreign key made a small workspace take most of a minute).
  while (fresh.size) {
    const edges = down.filter((f) => fresh.has(f.parent));
    if (!edges.length) break;
    const selects = edges.map((fk) => {
      const own = tenantTables.has(fk.child) ? `AND ${guard.replace(/tenant_id/g, "c.tenant_id")}` : "";
      return `SELECT '${fk.child}'::text AS tbl, c.ctid AS rid FROM ${q(fk.child)} c
        WHERE ${cols("c", fk.childCols)} IN (
          SELECT ${fk.parentCols.map((n) => `p.${q(n)}`).join(", ")} FROM ${q(fk.parent)} p
          JOIN purge_marks m ON m.tag = '${tag}' AND m.tbl = '${fk.parent}' AND m.rid = p.ctid)
        ${own}`;
    });
    const usesParams = selects.some((sql) => sql.includes("$1"));
    const result = await client.query(`
      WITH found AS (${selects.join(" UNION ")})
      INSERT INTO purge_marks SELECT '${tag}', f.tbl, f.rid FROM found f
      ON CONFLICT DO NOTHING RETURNING tbl`, usesParams ? params : []);
    fresh = new Set(result.rows.map((r) => r.tbl));
  }
}

/** True for a row nothing references by foreign key any more. */
function unreferenced(table, fks) {
  return fks
    .filter((fk) => fk.parent === table)
    .map((fk) => `NOT EXISTS (SELECT 1 FROM ${q(fk.child)} c WHERE ${cols("c", fk.childCols)} = ${cols("t", fk.parentCols)})`)
    .join(" AND ") || "TRUE";
}

/** How other workspaces touch MINE. Any non-zero answer blocks the purge. */
async function foreignTouches(client, fks, idTables, hasPackages) {
  const touches = {};
  const overlap = await client.query(`SELECT m.tbl, count(*)::int AS n FROM purge_marks m WHERE m.tag = 'mine'
    AND EXISTS (SELECT 1 FROM purge_marks o WHERE o.tag = 'others' AND o.tbl = m.tbl AND o.rid = m.rid) GROUP BY m.tbl`);
  for (const row of overlap.rows) touches[`shared:${row.tbl}`] = row.n;

  const mineTables = new Set((await client.query("SELECT DISTINCT tbl FROM purge_marks WHERE tag = 'mine'")).rows.map((r) => r.tbl));
  const edges = fks.filter((fk) => mineTables.has(fk.parent) && fk.parent !== "tenants");
  if (edges.length) {
    const selects = edges.map((fk) => `SELECT '${fk.child}->${fk.parent}'::text AS edge, count(*)::int AS n
      FROM ${q(fk.child)} c JOIN ${q(fk.parent)} p ON ${cols("c", fk.childCols)} = ${cols("p", fk.parentCols)}
      JOIN purge_marks pm ON pm.tag = 'mine' AND pm.tbl = '${fk.parent}' AND pm.rid = p.ctid
      WHERE NOT EXISTS (SELECT 1 FROM purge_marks cm WHERE cm.tag = 'mine' AND cm.tbl = '${fk.child}' AND cm.rid = c.ctid)`);
    const refs = await client.query(`SELECT edge, n FROM (${selects.join(" UNION ALL ")}) r WHERE n > 0`);
    for (const row of refs.rows) touches[`referenced:${row.edge}`] = row.n;
  }

  if (hasPackages) {
    for (const table of [...mineTables].filter((t) => idTables.has(t))) {
      // Members are "<type>:<id>" (evidence/a5b/domain.js); ids are UUIDs, so
      // the suffix identifies the row whatever the type is called.
      const named = await client.query(`SELECT count(*)::int AS n FROM ${q(table)} t
        JOIN purge_marks pm ON pm.tag = 'mine' AND pm.tbl = '${table}' AND pm.rid = t.ctid
        WHERE EXISTS (SELECT 1 FROM evidence_package_members m
          WHERE m.canonical_member_reference LIKE '%:' || t.id::text
            AND NOT EXISTS (SELECT 1 FROM purge_marks x WHERE x.tag = 'mine' AND x.tbl = 'evidence_package_members' AND x.rid = m.ctid))`);
      if (named.rows[0].n) touches[`packaged:${table}`] = named.rows[0].n;
    }
  }
  return touches;
}

/** @param beforeCommit optional async (files) => void, called with the files
 *  about to lose their rows while the transaction is still open - so the
 *  caller can record them durably before the rows that name them are gone. */
async function purgeTenant(db, tenantId, { dryRun = false, beforeCommit = null } = {}) {
  if (!tenantId) throw new Error("purgeTenant needs a tenant");
  let outcome;
  try {
    await db.transaction(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const fks = await foreignKeys(client);
      const tenantTables = await tablesWithColumn(client, "tenant_id");
      tenantTables.delete("tenants");
      const idTables = await tablesWithColumn(client, "id");
      const hasPackages = (await tablesWithColumn(client, "canonical_member_reference")).has("evidence_package_members");

      await client.query("CREATE TEMP TABLE purge_marks (tag text NOT NULL, tbl text NOT NULL, rid tid NOT NULL, PRIMARY KEY (tag, tbl, rid)) ON COMMIT DROP");
      await walkDown(client, { tag: "mine", seed: "tenant_id = $1", guard: "tenant_id = $1", params: [tenantId], fks, tenantTables });
      await walkDown(client, { tag: "others", seed: "tenant_id <> $1", guard: "tenant_id <> $1", params: [tenantId], fks, tenantTables });
      const counts = Object.fromEntries((await client.query("SELECT tbl, count(*)::int AS n FROM purge_marks WHERE tag = 'mine' GROUP BY tbl")).rows.map((r) => [r.tbl, r.n]));
      const touches = await foreignTouches(client, fks, idTables, hasPackages);
      if (Object.keys(touches).length) {
        outcome = { tenantId, dryRun, blocked: true, touches, counts, sharedRemoved: {}, files: [] };
        throw new DryRun(); // roll back: nothing of it is deleted
      }

      const files = [];
      if (counts.evidence_artifacts) {
        const rows = await client.query(`SELECT a.storage_provider AS provider, a.storage_key AS key FROM evidence_artifacts a
          WHERE a.ctid IN (SELECT rid FROM purge_marks WHERE tag = 'mine' AND tbl = 'evidence_artifacts') AND a.storage_key IS NOT NULL`);
        files.push(...rows.rows);
      }

      // Shared rows the deleted ones pointed at, noted before they go.
      await client.query("CREATE TEMP TABLE purge_shared (tbl text NOT NULL, rid tid NOT NULL, PRIMARY KEY (tbl, rid)) ON COMMIT DROP");
      for (let added = 1; added > 0;) {
        added = 0;
        for (const fk of fks.filter((f) => SHARED_TABLES.includes(f.parent) && f.child !== f.parent)) {
          const result = await client.query(`
            INSERT INTO purge_shared
            SELECT '${fk.parent}', p.ctid FROM ${q(fk.parent)} p
            WHERE ${cols("p", fk.parentCols)} IN (
              SELECT ${fk.childCols.map((n) => `c.${q(n)}`).join(", ")} FROM ${q(fk.child)} c
              WHERE c.ctid IN (SELECT rid FROM purge_marks WHERE tag = 'mine' AND tbl = '${fk.child}')
                 OR c.ctid IN (SELECT rid FROM purge_shared WHERE tbl = '${fk.child}'))
            ON CONFLICT DO NOTHING`);
          added += result.rowCount || 0;
        }
      }

      const shared = {};
      if (!dryRun) {
        for (const table of deleteOrder(Object.keys(counts), fks)) {
          await client.query(`DELETE FROM ${q(table)} WHERE ctid IN (SELECT rid FROM purge_marks WHERE tag = 'mine' AND tbl = '${table}')`);
        }
        for (const table of deleteOrder(SHARED_TABLES, fks)) {
          const textGuard = hasPackages ? `AND NOT EXISTS (SELECT 1 FROM evidence_package_members m WHERE m.canonical_member_reference LIKE '%:' || t.id::text)` : "";
          const removed = await client.query(`DELETE FROM ${q(table)} t
            WHERE t.ctid IN (SELECT rid FROM purge_shared WHERE tbl = '${table}') AND ${unreferenced(table, fks)} ${textGuard}`);
          if (removed.rowCount) shared[table] = removed.rowCount;
        }
        // The workspace itself, unless something still points at it.
        await client.query(`DELETE FROM tenants t WHERE t.id = $1 AND ${unreferenced("tenants", fks)}`, [tenantId]);
        if (beforeCommit) await beforeCommit(files);
      }

      outcome = { tenantId, dryRun, blocked: false, counts, sharedRemoved: shared, files };
      if (dryRun) throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  return outcome;
}

/** Whether any remaining row still names this uploaded file. Checked before a
 *  file's bytes are deleted, so bytes something still uses are never lost. */
async function fileStillNamed(db, { provider, key }) {
  const result = await db.query(
    "SELECT 1 FROM evidence_artifacts WHERE storage_key = $1 AND storage_provider IS NOT DISTINCT FROM $2 LIMIT 1",
    [key, provider],
  );
  return result.rows.length > 0;
}

module.exports = { purgeTenant, fileStillNamed, deleteOrder, SHARED_TABLES };
