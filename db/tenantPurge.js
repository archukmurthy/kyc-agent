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
 * THE RULE, learnt the hard way (the first version deleted another workspace's
 * rows, caught in review before it shipped): a row with no tenant of its own is
 * NOT necessarily this workspace's. Evidence deliberately shares public data -
 * a Companies House filing one workspace collected can be used by another. So:
 *
 *   MINE   = rows with tenant_id = this workspace, and every row reachable
 *            from them by following foreign keys downward (child -> parent),
 *            never crossing into a row that has another tenant_id.
 *   OTHERS = the same walk from every OTHER workspace's rows.
 *   DELETE = MINE minus OTHERS, then minus anything a surviving row still
 *            points at (by foreign key, or by text in a sealed evidence
 *            package), repeated until nothing changes.
 *
 * What survives is data another workspace built on - public company data, not
 * the tester's own. Two tables are shared by design and have no owner at all
 * (SHARED_TABLES): their rows go only once nothing references them.
 *
 * Runs at REPEATABLE READ, so every statement sees one snapshot: row addresses
 * (ctid) cannot be recycled under it, and a concurrent change to a row being
 * deleted fails the transaction instead of deleting something else.
 *
 * Returns what was (or on a dry run, would be) deleted per table, what was kept
 * because others use it, and the uploaded files - { provider, key } - whose
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

/** Takes out of the delete set anything a surviving row still needs, until stable. */
async function keepWhatOthersUse(client, fks, idTables, hasPackages) {
  const survivor = (table, alias) => `NOT EXISTS (SELECT 1 FROM purge_delete x WHERE x.tbl = '${table}' AND x.rid = ${alias}.ctid)`;
  for (let removed = 1; removed > 0;) {
    removed = 0;
    const deleting = new Set((await client.query("SELECT DISTINCT tbl FROM purge_delete")).rows.map((r) => r.tbl));
    const needed = fks.filter((f) => deleting.has(f.parent)).map((fk) => `SELECT '${fk.parent}'::text AS tbl, p.ctid AS rid
      FROM ${q(fk.parent)} p JOIN purge_delete d ON d.tbl = '${fk.parent}' AND d.rid = p.ctid
      WHERE EXISTS (SELECT 1 FROM ${q(fk.child)} c WHERE ${cols("c", fk.childCols)} = ${cols("p", fk.parentCols)} AND ${survivor(fk.child, "c")})`);
    // Sealed evidence packages name their members by text, with no foreign key.
    if (hasPackages) {
      for (const table of [...deleting].filter((t) => idTables.has(t))) {
        needed.push(`SELECT '${table}'::text AS tbl, t.ctid AS rid
          FROM ${q(table)} t JOIN purge_delete d ON d.tbl = '${table}' AND d.rid = t.ctid
          WHERE t.id::text IN (SELECT m.canonical_member_reference FROM evidence_package_members m WHERE ${survivor("evidence_package_members", "m")})`);
      }
    }
    if (!needed.length) break;
    const result = await client.query(`DELETE FROM purge_delete d WHERE (d.tbl, d.rid) IN (${needed.join(" UNION ")})`);
    removed = result.rowCount || 0;
  }
}

async function purgeTenant(db, tenantId, { dryRun = false } = {}) {
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
      await client.query("CREATE TEMP TABLE purge_delete (tbl text NOT NULL, rid tid NOT NULL, PRIMARY KEY (tbl, rid)) ON COMMIT DROP");
      await walkDown(client, { tag: "mine", seed: "tenant_id = $1", guard: "tenant_id = $1", params: [tenantId], fks, tenantTables });
      await walkDown(client, { tag: "others", seed: "tenant_id <> $1", guard: "tenant_id <> $1", params: [tenantId], fks, tenantTables });
      await client.query(`INSERT INTO purge_delete SELECT m.tbl, m.rid FROM purge_marks m WHERE m.tag = 'mine'
        AND NOT EXISTS (SELECT 1 FROM purge_marks o WHERE o.tag = 'others' AND o.tbl = m.tbl AND o.rid = m.rid)`);
      await keepWhatOthersUse(client, fks, idTables, hasPackages);

      const tally = async (sql) => Object.fromEntries((await client.query(sql)).rows.map((r) => [r.tbl, r.n]));
      const counts = await tally("SELECT tbl, count(*)::int AS n FROM purge_delete GROUP BY tbl");
      const kept = await tally(`SELECT m.tbl, count(*)::int AS n FROM purge_marks m WHERE m.tag = 'mine'
        AND NOT EXISTS (SELECT 1 FROM purge_delete d WHERE d.tbl = m.tbl AND d.rid = m.rid) GROUP BY m.tbl`);

      const files = [];
      if (counts.evidence_artifacts) {
        const rows = await client.query(`SELECT a.storage_provider AS provider, a.storage_key AS key FROM evidence_artifacts a
          WHERE a.ctid IN (SELECT rid FROM purge_delete WHERE tbl = 'evidence_artifacts') AND a.storage_key IS NOT NULL`);
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
              WHERE c.ctid IN (SELECT rid FROM purge_delete WHERE tbl = '${fk.child}')
                 OR c.ctid IN (SELECT rid FROM purge_shared WHERE tbl = '${fk.child}'))
            ON CONFLICT DO NOTHING`);
          added += result.rowCount || 0;
        }
      }

      const shared = {};
      if (!dryRun) {
        for (const table of deleteOrder(Object.keys(counts), fks)) {
          await client.query(`DELETE FROM ${q(table)} WHERE ctid IN (SELECT rid FROM purge_delete WHERE tbl = '${table}')`);
        }
        for (const table of deleteOrder(SHARED_TABLES, fks)) {
          const textGuard = hasPackages ? `AND t.id::text NOT IN (SELECT canonical_member_reference FROM evidence_package_members)` : "";
          const removed = await client.query(`DELETE FROM ${q(table)} t
            WHERE t.ctid IN (SELECT rid FROM purge_shared WHERE tbl = '${table}') AND ${unreferenced(table, fks)} ${textGuard}`);
          if (removed.rowCount) shared[table] = removed.rowCount;
        }
        // The workspace itself, unless something still points at it.
        await client.query(`DELETE FROM tenants t WHERE t.id = $1 AND ${unreferenced("tenants", fks)}`, [tenantId]);
      }

      outcome = { tenantId, dryRun, counts, kept, sharedRemoved: shared, files };
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
