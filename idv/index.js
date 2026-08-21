"use strict";

const { loadConfig } = require("./config");
const { DiditAdapter } = require("./providers/diditAdapter");
const { VeriffAdapter } = require("./providers/veriffAdapter");
const { ProviderHttpClient } = require("./providers/httpClient");
const { ProviderRouter } = require("./services/providerRouter");
const { CostPolicy } = require("./services/costPolicy");
const { IdvService } = require("./services/idvService");
const { UnavailableSecureIdentityStore } = require("./contracts/secureIdentityStore");
const {
  InMemorySessionRepository,
  InMemoryResultRepository,
  InMemoryWebhookReceiptStore,
  InMemoryEventStore,
  SyntheticOnlySecureIdentityStore,
} = require("./stores/inMemoryStores");

function createIdvModule({ env = process.env, fetchImpl, secureIdentityStore, stores = {}, now } = {}) {
  const config = loadConfig(env);
  const httpClient = new ProviderHttpClient({ fetchImpl });
  const costPolicy = new CostPolicy(config.costConfig);
  const adapters = {
    DIDIT: new DiditAdapter({ config: config.didit, httpClient, costPolicy, now }),
    VERIFF: new VeriffAdapter({ config: config.veriff, httpClient, costPolicy, now }),
  };
  const moduleStores = {
    sessionRepository: stores.sessionRepository || new InMemorySessionRepository(),
    resultRepository: stores.resultRepository || new InMemoryResultRepository(),
    webhookReceiptStore: stores.webhookReceiptStore || new InMemoryWebhookReceiptStore(),
    eventStore: stores.eventStore || new InMemoryEventStore(),
  };
  const identityStore = secureIdentityStore
    || (config.syntheticOnlyStore ? new SyntheticOnlySecureIdentityStore() : new UnavailableSecureIdentityStore());
  const service = new IdvService({
    adapters,
    router: new ProviderRouter({ defaultProvider: config.defaultProvider, overrides: config.routingOverrides }),
    ...moduleStores,
    secureIdentityStore: identityStore,
    now,
  });
  return { config, adapters, stores: moduleStores, secureIdentityStore: identityStore, service };
}

module.exports = {
  createIdvModule,
  ...require("./domain/constants"),
  ...require("./domain/canonical"),
  ...require("./domain/errors"),
};
