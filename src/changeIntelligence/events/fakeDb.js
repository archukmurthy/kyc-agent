/**
 * fakeDb.js — TEST-ONLY in-memory stand-in for the neon HTTP client.
 *
 * It lives at the events/ root (not under __tests__/) on purpose: Create React
 * App's Jest collects EVERY *.js under __tests__/ as a suite, so a helper there
 * would fail with "must contain at least one test". It is not imported by any
 * production module — only by the DAL test files.
 *
 * It is coupled ONLY to the `-- @qid:<name>` markers the DAL emits, not to the
 * SQL text, so the tests exercise the DAL's real query routing without a live
 * Postgres. It enforces the shape the DAL relies on (BIGSERIAL ids, JSONB
 * columns round-tripping as JS values) and offers NO update/delete entry point —
 * the only way a row changes is a fresh insert, mirroring the append-only table.
 */

const JSONB = new Set(['before_value', 'after_value']);
const clone = (r) => ({ ...r });

function qidOf(text) {
  const m = text.match(/@qid:(\w+)/);
  return m ? m[1] : null;
}

export function makeFakeDb() {
  const rows = [];
  let seq = 0;

  async function query(text, params = []) {
    const qid = qidOf(text);
    switch (qid) {
      case 'insert_event': {
        const cols = text
          .match(/INSERT INTO change_events \(([^)]+)\)/)[1]
          .split(',')
          .map((s) => s.trim());
        const row = {};
        cols.forEach((col, i) => {
          let v = params[i];
          if (JSONB.has(col) && typeof v === 'string') {
            try {
              v = JSON.parse(v);
            } catch (_) {
              /* leave as-is */
            }
          }
          row[col] = v === undefined ? null : v;
        });
        row.id = ++seq;
        row.created_at = `t${row.id}`;
        rows.push(row);
        return [clone(row)];
      }
      case 'get_by_id':
        return rows.filter((r) => r.id === params[0]).map((r) => ({ id: r.id }));
      case 'is_superseded':
        return rows.filter((r) => r.supersedes === params[0]).map((r) => ({ id: r.id }));
      case 'by_submission':
        return rows
          .filter((r) => r.submission_id === params[0])
          .sort((a, b) => a.id - b.id)
          .map(clone);
      case 'by_field':
        return rows
          .filter((r) => r.submission_id === params[0] && r.field_id === params[1])
          .sort((a, b) => a.id - b.id)
          .map(clone);
      case 'current_field_state': {
        const superseded = new Set(rows.map((r) => r.supersedes).filter((x) => x != null));
        const cand = rows
          .filter(
            (r) =>
              r.submission_id === params[0] &&
              r.field_id === params[1] &&
              !superseded.has(r.id),
          )
          .sort((a, b) => b.id - a.id);
        return cand.length ? [clone(cand[0])] : [];
      }
      case 'undecided':
        return rows
          .filter((r) => r.submission_id === params[0] && r.decided === false)
          .sort((a, b) => a.id - b.id)
          .map(clone);
      case 'escalations':
        return rows
          .filter((r) => r.submission_id === params[0] && r.escalation === true)
          .sort((a, b) => a.id - b.id)
          .map(clone);
      case 'amendment_docs':
        return rows
          .filter((r) => r.submission_id === params[0] && r.doc_type != null)
          .sort((a, b) => a.id - b.id)
          .map(clone);
      default:
        throw new Error(`fakeDb: unrecognised query (qid=${qid}):\n${text}`);
    }
  }

  return { query, _rows: rows };
}

// A minimal valid event for happy-path writes; spread + override per test.
export function baseEvent(overrides = {}) {
  return {
    submissionId: 'sub-1',
    fieldId: 'director.0.name',
    fieldClass: 'director',
    changeType: 'changed',
    workflow: 'ops_review',
    ...overrides,
  };
}
