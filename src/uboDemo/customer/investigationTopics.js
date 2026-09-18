export const CONTROL_DISCOVERY_MODE = Object.freeze({
  OWNERSHIP_FIRST_THEN_CONTROL: "OWNERSHIP_FIRST_THEN_CONTROL",
  OWNERSHIP_AND_CONTROL_IN_PARALLEL: "OWNERSHIP_AND_CONTROL_IN_PARALLEL",
});

export const QUESTION_ORIGIN = Object.freeze({
  SYSTEM_COMPARISON: "SYSTEM_COMPARISON",
  SYSTEM_CONTROL_DISCOVERY: "SYSTEM_CONTROL_DISCOVERY",
  SYSTEM_FALLBACK: "SYSTEM_FALLBACK",
  ANALYST_TOPIC: "ANALYST_TOPIC",
  ANALYST_CUSTOM: "ANALYST_CUSTOM",
});

export const INVESTIGATION_TOPIC_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  RESOLVED: "RESOLVED",
  SUPERSEDED: "SUPERSEDED",
  CANCELLED: "CANCELLED",
});

export const INVESTIGATION_TOPIC_CODE = Object.freeze({
  CURRENT_OWNERSHIP: "CURRENT_OWNERSHIP",
  OWNERSHIP_DISCREPANCY: "OWNERSHIP_DISCREPANCY",
  EXACT_OWNERSHIP_PERCENTAGE: "EXACT_OWNERSHIP_PERCENTAGE",
  OWNERSHIP_CHANGE: "OWNERSHIP_CHANGE",
  LAYER_QUALIFIER: "LAYER_QUALIFIER",
  NOMINEE_ARRANGEMENT: "NOMINEE_ARRANGEMENT",
  BEARER_SHARES: "BEARER_SHARES",
  TRUST_OR_TRUSTEE_INVOLVEMENT: "TRUST_OR_TRUSTEE_INVOLVEMENT",
  VOTING_RIGHTS: "VOTING_RIGHTS",
  BOARD_APPOINTMENT_OR_REMOVAL_RIGHTS: "BOARD_APPOINTMENT_OR_REMOVAL_RIGHTS",
  OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL: "OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL",
  CONTROL_DISCOVERY: "CONTROL_DISCOVERY",
  SENIOR_MANAGING_OFFICIAL: "SENIOR_MANAGING_OFFICIAL",
  ECONOMIC_INTEREST: "ECONOMIC_INTEREST",
  PROFIT_ENTITLEMENT: "PROFIT_ENTITLEMENT",
  LIQUIDATION_ENTITLEMENT: "LIQUIDATION_ENTITLEMENT",
  OTHER_ECONOMIC_RIGHT: "OTHER_ECONOMIC_RIGHT",
  ANALYST_CUSTOM: "ANALYST_CUSTOM",
});

const topic = (code, group, label, preview, options = {}) => Object.freeze({ code, group, label, preview, active: options.active !== false, rootFactTypes: options.rootFactTypes || [] });

export const INVESTIGATION_TOPIC_REGISTRY = Object.freeze([
  topic(INVESTIGATION_TOPIC_CODE.CURRENT_OWNERSHIP, "Ownership & ownership accuracy", "Current ownership", "Confirm that the ownership information is current where freshness or a material source difference creates a real doubt.", { rootFactTypes: ["CONFIRM_CURRENT_OWNERSHIP"] }),
  topic(INVESTIGATION_TOPIC_CODE.OWNERSHIP_DISCREPANCY, "Ownership & ownership accuracy", "Ownership discrepancy", "Resolve a material difference between the customer chart and independent ownership information.", { rootFactTypes: ["EXPLAIN_OWNERSHIP_DIFFERENCE"] }),
  topic(INVESTIGATION_TOPIC_CODE.EXACT_OWNERSHIP_PERCENTAGE, "Ownership & ownership accuracy", "Exact ownership percentage", "Establish an exact interest where the available range cannot determine the ownership outcome.", { rootFactTypes: ["EXACT_SHARE_PERCENTAGE"] }),
  topic(INVESTIGATION_TOPIC_CODE.OWNERSHIP_CHANGE, "Ownership & ownership accuracy", "Ownership change", "Establish whether ownership changed, when it changed and the resulting current position.", { rootFactTypes: ["OWNERSHIP_CHANGE_OCCURRED"] }),
  topic(INVESTIGATION_TOPIC_CODE.LAYER_QUALIFIER, "Ownership & ownership accuracy", "Role in the ownership layer", "Clarify whether a party is a shareholder, intermediary, nominee, trustee, trust or another vehicle.", { rootFactTypes: ["IDENTIFY_LAYER_QUALIFIER"] }),
  topic(INVESTIGATION_TOPIC_CODE.NOMINEE_ARRANGEMENT, "Special ownership arrangements", "Nominee arrangements", "Establish whether a recorded holder acts for another person or organisation. Follow-up questions appear only where relevant.", { rootFactTypes: ["CONFIRM_NOMINEE_ARRANGEMENT"] }),
  topic(INVESTIGATION_TOPIC_CODE.BEARER_SHARES, "Special ownership arrangements", "Bearer shares", "Establish whether bearer shares or warrants exist and who possesses or controls them.", { rootFactTypes: ["CONFIRM_BEARER_SHARES"] }),
  topic(INVESTIGATION_TOPIC_CODE.TRUST_OR_TRUSTEE_INVOLVEMENT, "Special ownership arrangements", "Trust or trustee involvement", "Identify trust involvement and collect the parties needed for analyst review.", { rootFactTypes: ["CONFIRM_TRUST_INVOLVEMENT"] }),
  topic(INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS, "Control", "Voting rights", "Establish whether any individual controls significant voting rights independently of the share ownership shown.", { rootFactTypes: ["IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER"] }),
  topic(INVESTIGATION_TOPIC_CODE.BOARD_APPOINTMENT_OR_REMOVAL_RIGHTS, "Control", "Board appointment or removal rights", "Establish whether an individual can appoint or remove a majority of the governing body.", { rootFactTypes: ["IDENTIFY_BOARD_APPOINTMENT_CONTROL"] }),
  topic(INVESTIGATION_TOPIC_CODE.OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL, "Control", "Other significant influence or control", "Establish whether an individual directs or strongly influences important decisions through another arrangement.", { rootFactTypes: ["IDENTIFY_SIGNIFICANT_INFLUENCE"] }),
  topic(INVESTIGATION_TOPIC_CODE.CONTROL_DISCOVERY, "Control", "All control routes", "Investigate voting rights, board appointment rights and other significant influence progressively.", { rootFactTypes: ["IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER"] }),
  topic(INVESTIGATION_TOPIC_CODE.SENIOR_MANAGING_OFFICIAL, "Fallback management", "Senior managing official", "Identify the person or people with practical overall management authority after ownership and control routes are exhausted.", { rootFactTypes: ["IDENTIFY_SENIOR_MANAGING_OFFICIAL"] }),
  topic(INVESTIGATION_TOPIC_CODE.ECONOMIC_INTEREST, "Future economic-interest routes", "Economic interest", "Reserved extension point; no customer flow is active in this iteration.", { active: false }),
  topic(INVESTIGATION_TOPIC_CODE.PROFIT_ENTITLEMENT, "Future economic-interest routes", "Profit entitlement", "Reserved extension point; no customer flow is active in this iteration.", { active: false }),
  topic(INVESTIGATION_TOPIC_CODE.LIQUIDATION_ENTITLEMENT, "Future economic-interest routes", "Liquidation entitlement", "Reserved extension point; no customer flow is active in this iteration.", { active: false }),
  topic(INVESTIGATION_TOPIC_CODE.OTHER_ECONOMIC_RIGHT, "Future economic-interest routes", "Other economic right", "Reserved extension point; no customer flow is active in this iteration.", { active: false }),
]);

export function topicDefinition(code) {
  return INVESTIGATION_TOPIC_REGISTRY.find((item) => item.code === code) || null;
}

export function createTopicActivation({ topicCode, caseId, targetEntityId, targetPersonId, analystReason, activatedBy, createdAt = new Date().toISOString() }) {
  const definition = topicDefinition(topicCode);
  if (!definition || !definition.active) throw new TypeError("Choose an active investigation topic.");
  const target = [targetEntityId, targetPersonId].filter(Boolean).join(":") || "case";
  return {
    contractVersion: "ubo-investigation-topic-activation-v1",
    id: `topic-activation:${topicCode}:${target}`,
    caseId,
    topicCode,
    ...(targetEntityId ? { targetEntityId } : {}),
    ...(targetPersonId ? { targetPersonId } : {}),
    origin: "ANALYST",
    ...(activatedBy ? { activatedBy } : {}),
    ...(analystReason ? { analystReason } : {}),
    status: INVESTIGATION_TOPIC_STATUS.ACTIVE,
    createdAt,
  };
}

export function semanticFactKey(type, { targetEntityId, targetPersonId, scope = "CUSTOMER_ENTITY" } = {}) {
  return [type, targetEntityId || "CUSTOMER_ENTITY", targetPersonId || "ANY_PERSON", scope].join(":");
}

export function mergeRequirementOrigins(existing, incoming) {
  const unique = (values) => [...new Set(values.filter(Boolean))];
  return {
    ...existing,
    originTypes: unique([...(existing.originTypes || []), ...(incoming.originTypes || [])]),
    comparisonItemIds: unique([...(existing.comparisonItemIds || []), ...(incoming.comparisonItemIds || [])]),
    topicActivationIds: unique([...(existing.topicActivationIds || []), ...(incoming.topicActivationIds || [])]),
  };
}

export function deduplicateFactRequirements(requirements = []) {
  const byKey = new Map();
  requirements.forEach((item) => {
    const key = item.semanticKey || semanticFactKey(item.type, item);
    byKey.set(key, byKey.has(key) ? mergeRequirementOrigins(byKey.get(key), item) : { ...item, semanticKey: key });
  });
  return [...byKey.values()];
}
