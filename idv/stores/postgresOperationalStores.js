"use strict";

const { randomUUID } = require("crypto");
const { assertNoRawEvidence } = require("../domain/canonical");

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function sessionFromRow(row) {
  if (!row) return null;
  return {
    ...row.session_data,
    secure_identity_reference: row.secure_identity_reference || row.session_data.secure_identity_reference || null,
    record_version: row.record_version,
  };
}

class PostgresSessionRepository {
  constructor({ transactionRunner, now = () => new Date() }) { this.transactions = transactionRunner; this.now = now; this.durable = true; }

  async create(session) {
    assertNoRawEvidence(session);
    return this.transactions.withTransaction(async (client) => {
      const stored = { ...clone(session), record_version: 1 };
      await client.query(`
        INSERT INTO idv_sessions
          (internal_idv_session_id,tenant_id,customer_context_id,subject_person_id,provider,provider_session_id,
           provider_report_id,canonical_status,original_provider_status,secure_identity_reference,session_data,record_version,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,1,$12,$13)
      `, [
        stored.internal_idv_session_id, stored.tenant_id, stored.customer_context_id, stored.subject_person_id,
        stored.provider, stored.provider_session_id, stored.provider_report_id, stored.canonical_status,
        stored.original_provider_status, stored.secure_identity_reference || null, JSON.stringify(stored),
        stored.created_at, this.now().toISOString(),
      ]);
      return stored;
    });
  }

  async get(id, tenantId) {
    return this.transactions.withTransaction(async (client) => {
      const params = tenantId ? [id, tenantId] : [id];
      const result = await client.query(`SELECT * FROM idv_sessions WHERE internal_idv_session_id=$1${tenantId ? " AND tenant_id=$2" : ""}`, params);
      return sessionFromRow(result.rows[0]);
    });
  }

  async getByProviderSession(provider, providerSessionId) {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query("SELECT * FROM idv_sessions WHERE provider=$1 AND provider_session_id=$2", [provider, providerSessionId]);
      return sessionFromRow(result.rows[0]);
    });
  }

  async save(session, expectedVersion) {
    assertNoRawEvidence(session);
    return this.transactions.withTransaction(async (client) => {
      const next = { ...clone(session), record_version: Number(expectedVersion) + 1 };
      const result = await client.query(`
        UPDATE idv_sessions SET provider_report_id=$3, canonical_status=$4, original_provider_status=$5,
          secure_identity_reference=$6, session_data=$7::jsonb, record_version=record_version+1, updated_at=$8
        WHERE internal_idv_session_id=$1 AND tenant_id=$2 AND record_version=$9
        RETURNING *
      `, [
        session.internal_idv_session_id, session.tenant_id, session.provider_report_id, session.canonical_status,
        session.original_provider_status, session.secure_identity_reference || null, JSON.stringify(next),
        this.now().toISOString(), expectedVersion,
      ]);
      if (!result.rows[0]) {
        const error = new Error("Concurrent or cross-tenant IDV session update");
        error.code = "IDV_CONCURRENT_UPDATE";
        throw error;
      }
      return sessionFromRow(result.rows[0]);
    });
  }

  async list({ tenantId, from, to } = {}) {
    return this.transactions.withTransaction(async (client) => {
      const conditions = []; const params = [];
      if (tenantId) { params.push(tenantId); conditions.push(`tenant_id=$${params.length}`); }
      if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
      if (to) { params.push(to); conditions.push(`created_at < $${params.length}`); }
      const result = await client.query(`SELECT * FROM idv_sessions${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at`, params);
      return result.rows.map(sessionFromRow);
    });
  }
}

class PostgresResultRepository {
  constructor({ transactionRunner }) { this.transactions = transactionRunner; this.durable = true; }
  async save(internalIdvSessionId, resultWithoutPii, tenantId) {
    if (resultWithoutPii.identity_attributes) throw new TypeError("Identity attributes must be persisted through SecureIdentityStore");
    assertNoRawEvidence(resultWithoutPii);
    return this.transactions.withTransaction(async (client) => {
      const resolvedTenant = tenantId || (await client.query("SELECT tenant_id FROM idv_sessions WHERE internal_idv_session_id=$1", [internalIdvSessionId])).rows[0]?.tenant_id;
      if (!resolvedTenant) throw new Error("IDV result session is unavailable");
      await client.query(`
        INSERT INTO idv_results (internal_idv_session_id,tenant_id,result_data,updated_at)
        VALUES ($1,$2,$3::jsonb,now())
        ON CONFLICT (internal_idv_session_id) DO UPDATE SET result_data=EXCLUDED.result_data,updated_at=now()
      `, [internalIdvSessionId, resolvedTenant, JSON.stringify(resultWithoutPii)]);
      return clone(resultWithoutPii);
    });
  }
  async get(internalIdvSessionId, tenantId) {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query(`SELECT result_data FROM idv_results WHERE internal_idv_session_id=$1${tenantId ? " AND tenant_id=$2" : ""}`, tenantId ? [internalIdvSessionId, tenantId] : [internalIdvSessionId]);
      return clone(result.rows[0]?.result_data || null);
    });
  }
}

class PostgresWebhookReceiptStore {
  constructor({ transactionRunner }) { this.transactions = transactionRunner; this.durable = true; }
  async begin(provider, eventId, receivedAt = new Date()) {
    return this.transactions.withTransaction(async (client) => {
      const claimed = await client.query(`
        INSERT INTO idv_webhook_receipts (provider,event_id,state,received_at,attempts)
        VALUES ($1,$2,'PROCESSING',$3,1)
        ON CONFLICT (provider,event_id) DO UPDATE SET state='PROCESSING',received_at=EXCLUDED.received_at,
          attempts=idv_webhook_receipts.attempts+1,error_code=NULL
        WHERE idv_webhook_receipts.state='FAILED'
        RETURNING *
      `, [provider, eventId, new Date(receivedAt).toISOString()]);
      if (claimed.rows[0]) return { accepted: true, receipt: claimed.rows[0] };
      const existing = await client.query("SELECT * FROM idv_webhook_receipts WHERE provider=$1 AND event_id=$2", [provider, eventId]);
      return { accepted: false, receipt: existing.rows[0] };
    });
  }
  async complete(provider, eventId, metadata = {}) {
    return this.transactions.withTransaction((client) => client.query(`
      UPDATE idv_webhook_receipts SET state='COMPLETED',completed_at=now(),tenant_id=$3,
        internal_idv_session_id=$4,reconciliation=$5 WHERE provider=$1 AND event_id=$2
    `, [provider, eventId, metadata.tenant_id || null, metadata.internal_idv_session_id || null, metadata.reconciliation || null]));
  }
  async fail(provider, eventId, errorCode) {
    return this.transactions.withTransaction((client) => client.query(
      "UPDATE idv_webhook_receipts SET state='FAILED',error_code=$3 WHERE provider=$1 AND event_id=$2",
      [provider, eventId, errorCode || "IDV_WEBHOOK_PROCESSING_FAILED"],
    ));
  }
}

class PostgresEventStore {
  constructor({ transactionRunner }) { this.transactions = transactionRunner; this.durable = true; }
  async append(event) {
    assertNoRawEvidence(event);
    await this.transactions.withTransaction((client) => client.query(`
      INSERT INTO idv_lifecycle_events (event_id,tenant_id,internal_idv_session_id,event_type,occurred_at,dimensions,metadata)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT (event_id) DO NOTHING
    `, [event.event_id, event.dimensions.tenant_id, event.internal_idv_session_id, event.event_type, event.occurred_at, JSON.stringify(event.dimensions), JSON.stringify(event.metadata)]));
    return clone(event);
  }
  async list({ tenantId, from, to } = {}) {
    return this.transactions.withTransaction(async (client) => {
      const conditions = []; const params = [];
      if (tenantId) { params.push(tenantId); conditions.push(`tenant_id=$${params.length}`); }
      if (from) { params.push(from); conditions.push(`occurred_at >= $${params.length}`); }
      if (to) { params.push(to); conditions.push(`occurred_at < $${params.length}`); }
      const result = await client.query(`SELECT * FROM idv_lifecycle_events${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY occurred_at,event_id`, params);
      return result.rows.map((row) => ({ event_id: row.event_id, event_type: row.event_type, internal_idv_session_id: row.internal_idv_session_id, occurred_at: new Date(row.occurred_at).toISOString(), dimensions: row.dimensions, metadata: row.metadata }));
    });
  }
  async listForSession(id, tenantId) {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query(`SELECT * FROM idv_lifecycle_events WHERE internal_idv_session_id=$1${tenantId ? " AND tenant_id=$2" : ""} ORDER BY occurred_at,event_id`, tenantId ? [id, tenantId] : [id]);
      return result.rows.map((row) => ({ event_id: row.event_id, event_type: row.event_type, internal_idv_session_id: row.internal_idv_session_id, occurred_at: new Date(row.occurred_at).toISOString(), dimensions: row.dimensions, metadata: row.metadata }));
    });
  }
}

class PostgresCostLedgerRepository {
  constructor({ transactionRunner }) { this.transactions = transactionRunner; this.durable = true; }
  async append(entry) {
    const stored = { cost_entry_id: entry.cost_entry_id || randomUUID(), ...clone(entry) };
    await this.transactions.withTransaction((client) => client.query(`
      INSERT INTO idv_cost_ledger
        (cost_entry_id,tenant_id,internal_idv_session_id,provider,workflow,module,billing_trigger,amount,currency,
         cost_basis,pricing_source,pricing_version,incurred_at,confirmed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (cost_entry_id) DO NOTHING
    `, [stored.cost_entry_id,stored.tenant_id,stored.internal_idv_session_id,stored.provider,stored.workflow || null,stored.module || null,stored.billing_trigger || null,stored.amount ?? null,stored.currency,stored.cost_basis,stored.pricing_source || null,stored.pricing_version || null,stored.incurred_at || null,stored.confirmed_at || null]));
    return stored;
  }
  async list({ tenantId, internalIdvSessionId } = {}) {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query("SELECT * FROM idv_cost_ledger WHERE tenant_id=$1 AND ($2::uuid IS NULL OR internal_idv_session_id=$2) ORDER BY created_at", [tenantId, internalIdvSessionId || null]);
      return result.rows;
    });
  }
}

class PostgresPocGroundTruthRepository {
  constructor({ transactionRunner }) { this.transactions = transactionRunner; this.durable = true; }
  async save(label) {
    const stored = { ground_truth_id: label.ground_truth_id || randomUUID(), ...clone(label) };
    await this.transactions.withTransaction((client) => client.query(`
      INSERT INTO idv_poc_ground_truth
        (ground_truth_id,tenant_id,internal_idv_session_id,test_case_id,genuine_user_label,label_source,
         valid_technical_opportunity,comparison_flags,recorded_by_actor_id,recorded_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
      ON CONFLICT (tenant_id,internal_idv_session_id) DO UPDATE SET genuine_user_label=EXCLUDED.genuine_user_label,
        label_source=EXCLUDED.label_source,valid_technical_opportunity=EXCLUDED.valid_technical_opportunity,
        comparison_flags=EXCLUDED.comparison_flags,recorded_by_actor_id=EXCLUDED.recorded_by_actor_id,recorded_at=EXCLUDED.recorded_at
    `, [stored.ground_truth_id,stored.tenant_id,stored.internal_idv_session_id,stored.test_case_id,stored.genuine_user_label ?? null,stored.label_source || null,stored.valid_technical_opportunity ?? null,JSON.stringify(stored.comparison_flags || {}),stored.recorded_by_actor_id,stored.recorded_at]));
    return stored;
  }
  async get(internalIdvSessionId, tenantId) {
    return this.transactions.withTransaction(async (client) => (await client.query("SELECT * FROM idv_poc_ground_truth WHERE tenant_id=$1 AND internal_idv_session_id=$2", [tenantId, internalIdvSessionId])).rows[0] || null);
  }
  async list({ tenantId, from, to } = {}) {
    return this.transactions.withTransaction(async (client) => {
      const result = await client.query("SELECT * FROM idv_poc_ground_truth WHERE tenant_id=$1 AND ($2::timestamptz IS NULL OR recorded_at >= $2) AND ($3::timestamptz IS NULL OR recorded_at < $3)", [tenantId, from || null, to || null]);
      return result.rows;
    });
  }
}

module.exports = {
  PostgresSessionRepository,
  PostgresResultRepository,
  PostgresWebhookReceiptStore,
  PostgresEventStore,
  PostgresCostLedgerRepository,
  PostgresPocGroundTruthRepository,
};
