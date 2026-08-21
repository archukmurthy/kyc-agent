"use strict";

const { PROVIDERS } = require("../domain/constants");

const MATCH_FIELDS = Object.freeze(["tenantId", "country", "documentType", "workflow"]);

class ProviderRouter {
  constructor({ defaultProvider = PROVIDERS.DIDIT, overrides = [] } = {}) {
    this.defaultProvider = defaultProvider;
    this.overrides = overrides.map((rule, index) => ({ ...rule, _index: index }));
    this.validateProvider(defaultProvider);
    for (const rule of this.overrides) this.validateProvider(rule.provider);
  }

  validateProvider(provider) {
    if (!Object.values(PROVIDERS).includes(provider)) throw new TypeError(`Unsupported IDV provider: ${provider}`);
  }

  select(context = {}) {
    const matches = this.overrides
      .filter((rule) => MATCH_FIELDS.every((field) => rule[field] == null || rule[field] === context[field]))
      .map((rule) => ({
        rule,
        specificity: MATCH_FIELDS.filter((field) => rule[field] != null).length,
      }))
      .sort((a, b) => b.specificity - a.specificity || a.rule._index - b.rule._index);
    return matches[0]?.rule.provider || this.defaultProvider;
  }
}

module.exports = { ProviderRouter, MATCH_FIELDS };
