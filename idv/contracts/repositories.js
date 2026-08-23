"use strict";

class IdvSessionRepository {
  async create() { throw new Error("Not implemented"); }
  async get() { throw new Error("Not implemented"); }
  async getByProviderSession() { throw new Error("Not implemented"); }
  async save() { throw new Error("Not implemented"); }
  async list() { throw new Error("Not implemented"); }
}

class IdvResultRepository {
  async save() { throw new Error("Not implemented"); }
  async get() { throw new Error("Not implemented"); }
}

class WebhookReceiptStore {
  async begin() { throw new Error("Not implemented"); }
  async complete() { throw new Error("Not implemented"); }
  async fail() { throw new Error("Not implemented"); }
}

class IdvEventStore {
  async append() { throw new Error("Not implemented"); }
  async list() { throw new Error("Not implemented"); }
  async listForSession() { throw new Error("Not implemented"); }
}

class IdvCostLedgerRepository {
  async append() { throw new Error("Not implemented"); }
  async list() { throw new Error("Not implemented"); }
}

class IdvPocGroundTruthRepository {
  async save() { throw new Error("Not implemented"); }
  async get() { throw new Error("Not implemented"); }
  async list() { throw new Error("Not implemented"); }
}

module.exports = {
  IdvSessionRepository,
  IdvResultRepository,
  WebhookReceiptStore,
  IdvEventStore,
  IdvCostLedgerRepository,
  IdvPocGroundTruthRepository,
};
