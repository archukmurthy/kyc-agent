"use strict";

class CostPolicy {
  constructor(config = {}) { this.config = config; }

  estimate({ provider, workflow, modules = [], currency = "USD" }) {
    const providerConfig = this.config[provider] || {};
    const workflowConfig = providerConfig.workflows?.[workflow] || providerConfig.default || {};
    const hasBase = workflowConfig.base !== undefined && workflowConfig.base !== null && workflowConfig.base !== "";
    const base = hasBase ? Number(workflowConfig.base) : null;
    const moduleCosts = modules.map((module) => ({
      module,
      amount: workflowConfig.modules?.[module] === undefined ? null : Number(workflowConfig.modules[module]),
    }));
    const fullyPriced = hasBase && Number.isFinite(base) && moduleCosts.every((item) => Number.isFinite(item.amount));
    const amount = fullyPriced ? moduleCosts.reduce((sum, item) => sum + item.amount, base) : null;
    return {
      provider,
      workflow: workflow || null,
      modules_executed: [...modules],
      estimated_cost: amount,
      actual_confirmed_cost: null,
      currency: workflowConfig.currency || currency,
      cost_source: workflowConfig.source || null,
      cost_version: workflowConfig.version || null,
      pricing_complete: fullyPriced,
      billing_trigger: workflowConfig.billing_trigger || null,
      module_costs: moduleCosts,
    };
  }
}

module.exports = { CostPolicy };
