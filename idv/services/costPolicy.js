"use strict";

class CostPolicy {
  constructor(config = {}) { this.config = config; }

  estimate({ provider, workflow, modules = [], currency = "USD" }) {
    const providerConfig = this.config[provider] || {};
    const workflowConfig = providerConfig.workflows?.[workflow] || providerConfig.default || {};
    const base = Number(workflowConfig.base || 0);
    const moduleCosts = modules.map((module) => ({
      module,
      amount: Number(workflowConfig.modules?.[module] || 0),
    }));
    const amount = moduleCosts.reduce((sum, item) => sum + item.amount, base);
    return {
      provider,
      workflow: workflow || null,
      modules_executed: [...modules],
      estimated_cost: amount || null,
      actual_cost: null,
      currency: workflowConfig.currency || currency,
      cost_source: workflowConfig.source || null,
      cost_version: workflowConfig.version || null,
      module_costs: moduleCosts,
    };
  }
}

module.exports = { CostPolicy };
