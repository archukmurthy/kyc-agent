"use strict";

const { loadConfig } = require("./config");
const { DiditAdapter } = require("./providers/diditAdapter");
const { VeriffAdapter } = require("./providers/veriffAdapter");
const { ProviderHttpClient } = require("./providers/httpClient");
const { ProviderRouter } = require("./services/providerRouter");
const { CostPolicy } = require("./services/costPolicy");
const { IdvService } = require("./services/idvService");
const { ConfigurationError, ManagedKeyRequiredError, SecureStoreRequiredError } = require("./domain/errors");
const { UnavailableSecureIdentityStore } = require("./contracts/secureIdentityStore");
const { EnvelopeEncryption } = require("./security/envelopeEncryption");
const { requireProductionManagedKeyProvider } = require("./security/managedKeyProvider");
const { OidcJwtAuthenticator } = require("./security/oidcJwtAuthenticator");
const { IdentityAccessAuthorizer, bindIdentityAccess } = require("./security/securityContext");
const { PostgresTransactionRunner } = require("./persistence/postgresTransactionRunner");
const { PostgresSecureIdentityStore } = require("./stores/postgresSecureIdentityStore");
const {
  PostgresSessionRepository,
  PostgresResultRepository,
  PostgresWebhookReceiptStore,
  PostgresEventStore,
  PostgresCostLedgerRepository,
  PostgresPocGroundTruthRepository,
} = require("./stores/postgresOperationalStores");
const {
  InMemorySessionRepository,
  InMemoryResultRepository,
  InMemoryWebhookReceiptStore,
  InMemoryEventStore,
  InMemoryCostLedgerRepository,
  InMemoryPocGroundTruthRepository,
  SyntheticOnlySecureIdentityStore,
} = require("./stores/inMemoryStores");

function defaultIdentityAccessFactory({ session, purpose, fields, correlationId, securityContext }) {
  return bindIdentityAccess(securityContext, {
    subjectId: session.subject_person_id,
    purpose,
    fields,
    correlationId,
  });
}

function assertProductionStores(stores) {
  for (const [name, store] of Object.entries(stores)) {
    if (!store || store.durable !== true) throw new ConfigurationError(`Production IDV requires durable ${name}`);
  }
}

function createIdvModule({
  env = process.env,
  fetchImpl,
  adapters: injectedAdapters = {},
  managedKeyProvider,
  secureIdentityStore,
  subjectTenantResolver,
  authorizer,
  identityAccessFactory = defaultIdentityAccessFactory,
  transactionRunner,
  stores = {},
  now,
} = {}) {
  const config = loadConfig(env);
  const httpClient = new ProviderHttpClient({ fetchImpl });
  const costPolicy = new CostPolicy(config.costConfig);
  const adapters = {
    DIDIT: new DiditAdapter({ config: config.didit, httpClient, costPolicy, now }),
    VERIFF: new VeriffAdapter({ config: config.veriff, httpClient, costPolicy, now }),
    ...injectedAdapters,
  };
  const enabledAdapters = Object.fromEntries(Object.entries(adapters).filter(([provider]) => config.enabledProviders.includes(provider) || Object.hasOwn(injectedAdapters, provider)));
  const runner = transactionRunner || (config.databaseUrl ? new PostgresTransactionRunner({ connectionString: config.databaseUrl }) : null);
  const moduleStores = runner ? {
    sessionRepository: stores.sessionRepository || new PostgresSessionRepository({ transactionRunner: runner, now }),
    resultRepository: stores.resultRepository || new PostgresResultRepository({ transactionRunner: runner }),
    webhookReceiptStore: stores.webhookReceiptStore || new PostgresWebhookReceiptStore({ transactionRunner: runner }),
    eventStore: stores.eventStore || new PostgresEventStore({ transactionRunner: runner }),
    costLedgerRepository: stores.costLedgerRepository || new PostgresCostLedgerRepository({ transactionRunner: runner }),
    groundTruthRepository: stores.groundTruthRepository || new PostgresPocGroundTruthRepository({ transactionRunner: runner }),
  } : {
    sessionRepository: stores.sessionRepository || new InMemorySessionRepository(),
    resultRepository: stores.resultRepository || new InMemoryResultRepository(),
    webhookReceiptStore: stores.webhookReceiptStore || new InMemoryWebhookReceiptStore(),
    eventStore: stores.eventStore || new InMemoryEventStore(),
    costLedgerRepository: stores.costLedgerRepository || new InMemoryCostLedgerRepository(),
    groundTruthRepository: stores.groundTruthRepository || new InMemoryPocGroundTruthRepository(),
  };
  const accessAuthorizer = authorizer || (subjectTenantResolver ? new IdentityAccessAuthorizer({ subjectTenantResolver }) : null);
  let identityStore = secureIdentityStore;
  if (!identityStore && runner && managedKeyProvider && accessAuthorizer) {
    if (config.production) requireProductionManagedKeyProvider(managedKeyProvider);
    identityStore = new PostgresSecureIdentityStore({
      transactionRunner: runner,
      envelopeEncryption: new EnvelopeEncryption({ managedKeyProvider }),
      authorizer: accessAuthorizer,
      now,
    });
  }
  if (!identityStore) {
    identityStore = config.syntheticOnlyStore ? new SyntheticOnlySecureIdentityStore() : new UnavailableSecureIdentityStore();
  }
  if (config.production) {
    assertProductionStores(moduleStores);
    requireProductionManagedKeyProvider(managedKeyProvider);
    if (!accessAuthorizer || typeof subjectTenantResolver !== "function") throw new ConfigurationError("Production IDV requires a trusted subject-to-tenant resolver and authorizer");
    if (!(identityStore instanceof PostgresSecureIdentityStore) || identityStore.productionReady !== true) throw new SecureStoreRequiredError();
    if (identityStore.managedKeyProvider !== managedKeyProvider) throw new ManagedKeyRequiredError("Secure identity store must use the approved production ManagedKeyProvider instance");
    if (identityAccessFactory !== defaultIdentityAccessFactory && typeof identityAccessFactory !== "function") throw new ConfigurationError("Production identityAccessFactory is invalid");
  }
  if (config.runtimeMode === "poc" && !config.syntheticOnlyStore && !(identityStore instanceof PostgresSecureIdentityStore)) {
    throw new ManagedKeyRequiredError("A controlled real-human POC requires encrypted durable identity storage");
  }
  const authenticator = config.oidc.issuer && config.oidc.audience ? new OidcJwtAuthenticator({
    ...config.oidc,
    fetchImpl,
  }) : null;
  const service = new IdvService({
    adapters: enabledAdapters,
    router: new ProviderRouter({
      defaultProvider: config.defaultProvider,
      overrides: config.routingOverrides,
      availableProviders: Object.keys(enabledAdapters),
    }),
    ...moduleStores,
    secureIdentityStore: identityStore,
    identityAccessFactory,
    now,
  });
  return {
    config,
    adapters: enabledAdapters,
    stores: moduleStores,
    transactionRunner: runner,
    managedKeyProvider,
    authorizer: accessAuthorizer,
    authenticator,
    secureIdentityStore: identityStore,
    service,
  };
}

module.exports = {
  createIdvModule,
  defaultIdentityAccessFactory,
  ...require("./domain/constants"),
  ...require("./domain/canonical"),
  ...require("./domain/errors"),
  PURPOSES: require("./security/securityContext").PURPOSES,
  SecurityContext: require("./security/securityContext").SecurityContext,
  bindIdentityAccess: require("./security/securityContext").bindIdentityAccess,
  IdentityAccessAuthorizer: require("./security/securityContext").IdentityAccessAuthorizer,
  DEFAULT_PURPOSE_POLICY: require("./security/securityContext").DEFAULT_PURPOSE_POLICY,
  RESTRICTED_IDENTITY_CONCEPTS: require("./security/securityContext").RESTRICTED_IDENTITY_CONCEPTS,
  ...require("./security/managedKeyProvider"),
};
