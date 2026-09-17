import {
  CONTROL_DISCOVERY_MODE,
  deduplicateFactRequirements,
  INVESTIGATION_TOPIC_CODE,
  QUESTION_ORIGIN,
  semanticFactKey,
  topicDefinition,
} from "./investigationTopics";

export const OWNERSHIP_RESOLUTION_STATUS = Object.freeze({ COMPLETE: "COMPLETE", INDETERMINATE: "INDETERMINATE", UNKNOWN: "UNKNOWN", EVIDENCE_REQUIRED: "EVIDENCE_REQUIRED", CONFLICTED: "CONFLICTED" });
export const CONTROL_RESOLUTION_STATUS = Object.freeze({ NOT_STARTED: "NOT_STARTED", IN_PROGRESS: "IN_PROGRESS", COMPLETE: "COMPLETE", ANALYST_REVIEW: "ANALYST_REVIEW" });
export const CONTROL_ASSESSMENT_OUTCOME = Object.freeze({ CONTROL_UBO: "CONTROL_UBO", NOT_CONTROL_UBO: "NOT_CONTROL_UBO", INDETERMINATE: "INDETERMINATE" });
export const UBO_BASIS = Object.freeze({ SHARE_OWNERSHIP: "SHARE_OWNERSHIP", VOTING_RIGHTS: "VOTING_RIGHTS", BOARD_CONTROL: "BOARD_CONTROL", SIGNIFICANT_INFLUENCE: "SIGNIFICANT_INFLUENCE" });

const TYPE = Object.freeze({
  CONFIRM_CURRENT_OWNERSHIP: "CONFIRM_CURRENT_OWNERSHIP",
  IDENTIFY_LAYER_QUALIFIER: "IDENTIFY_LAYER_QUALIFIER",
  CONFIRM_BEARER_SHARES: "CONFIRM_BEARER_SHARES",
  IDENTIFY_BEARER_ENTITY: "IDENTIFY_BEARER_ENTITY",
  IDENTIFY_BEARER_INTEREST: "IDENTIFY_BEARER_INTEREST",
  IDENTIFY_BEARER_CONTROLLER: "IDENTIFY_BEARER_CONTROLLER",
  IDENTIFY_BEARER_CUSTODIAN: "IDENTIFY_BEARER_CUSTODIAN",
  CONFIRM_TRUST_INVOLVEMENT: "CONFIRM_TRUST_INVOLVEMENT",
  IDENTIFY_TRUST_SHAREHOLDER: "IDENTIFY_TRUST_SHAREHOLDER",
  IDENTIFY_TRUST_NAME: "IDENTIFY_TRUST_NAME",
  IDENTIFY_TRUSTEES: "IDENTIFY_TRUSTEES",
  IDENTIFY_TRUST_PARTIES: "IDENTIFY_TRUST_PARTIES",
  IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER: "IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER",
  IDENTIFY_VOTING_RIGHT_HOLDERS: "IDENTIFY_VOTING_RIGHT_HOLDERS",
  ESTABLISH_VOTING_RIGHT_PERCENTAGE: "ESTABLISH_VOTING_RIGHT_PERCENTAGE",
  IDENTIFY_BOARD_APPOINTMENT_CONTROL: "IDENTIFY_BOARD_APPOINTMENT_CONTROL",
  IDENTIFY_BOARD_CONTROLLER: "IDENTIFY_BOARD_CONTROLLER",
  ESTABLISH_BOARD_CONTROL_RIGHT: "ESTABLISH_BOARD_CONTROL_RIGHT",
  IDENTIFY_SIGNIFICANT_INFLUENCE: "IDENTIFY_SIGNIFICANT_INFLUENCE",
  IDENTIFY_INFLUENTIAL_PERSON: "IDENTIFY_INFLUENTIAL_PERSON",
  ESTABLISH_INFLUENCE_TYPE: "ESTABLISH_INFLUENCE_TYPE",
  EXPLAIN_SIGNIFICANT_INFLUENCE: "EXPLAIN_SIGNIFICANT_INFLUENCE",
  IDENTIFY_SENIOR_MANAGING_OFFICIAL: "IDENTIFY_SENIOR_MANAGING_OFFICIAL",
  IDENTIFY_SENIOR_MANAGEMENT_ROLE: "IDENTIFY_SENIOR_MANAGEMENT_ROLE",
  ESTABLISH_SENIOR_MANAGEMENT_AUTHORITY: "ESTABLISH_SENIOR_MANAGEMENT_AUTHORITY",
  ANALYST_CUSTOM: "ANALYST_CUSTOM",
});

export const DISCOVERY_FACT_REQUIREMENT_TYPE = TYPE;

const options = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const YES_NO_UNSURE = options(["NO", "No"], ["YES", "Yes"], ["NOT_SURE", "I'm not sure"]);
const DISCOVERY_EVIDENCE = Object.freeze({
  VOTING_RIGHTS: { purpose: "Establish the declared voting-right arrangement.", preferred: ["ARTICLES_OF_ASSOCIATION", "SHARE_CLASS_RIGHTS", "REGISTER_OF_MEMBERS"], alternative: ["SHAREHOLDERS_AGREEMENT", "VOTING_AGREEMENT", "INVESTOR_RIGHTS_AGREEMENT", "OTHER_GOVERNING_DOCUMENT"] },
  BOARD_CONTROL: { purpose: "Establish the declared board appointment or removal right.", preferred: ["ARTICLES_OF_ASSOCIATION", "SHAREHOLDERS_AGREEMENT"], alternative: ["INVESTOR_RIGHTS_AGREEMENT", "BOARD_NOMINATION_AGREEMENT", "GOVERNING_DOCUMENT", "OTHER_SUPPORTING_DOCUMENT"] },
  SIGNIFICANT_INFLUENCE: { purpose: "Support the declared significant influence or control arrangement.", preferred: ["SHAREHOLDERS_AGREEMENT", "RESERVED_MATTERS_SCHEDULE"], alternative: ["VOTING_AGREEMENT", "INVESTOR_RIGHTS_AGREEMENT", "POWER_OF_ATTORNEY", "BOARD_OR_GOVERNANCE_AGREEMENT", "OTHER_CONTRACTUAL_ARRANGEMENT", "CUSTOMER_DECLARATION"] },
  BEARER: { purpose: "Establish the bearer interest and the person or custodian controlling it.", preferred: ["REGISTER_OF_MEMBERS", "CUSTODY_RECORD"], alternative: ["SHARE_WARRANT", "CUSTOMER_DECLARATION", "OTHER_SUPPORTING_DOCUMENT"] },
  TRUST: { purpose: "Establish the trust or trustee involvement and relevant parties.", preferred: ["TRUST_DEED", "DECLARATION_OF_TRUST"], alternative: ["TRUSTEE_APPOINTMENT", "CUSTOMER_DECLARATION", "OTHER_SUPPORTING_DOCUMENT"] },
});
const safe = (value) => String(value || "item").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "item";
const questionId = (requirement) => `question:${requirement.id}`;
const answerFor = (requirement, answers) => requirement ? answers[questionId(requirement)] || null : null;
const names = (value) => String(value || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
const activeTopics = (activations) => activations.filter(({ status }) => status === "ACTIVE");
const hasTopic = (activations, ...codes) => activeTopics(activations).some(({ topicCode }) => codes.includes(topicCode));
const activationsFor = (activations, ...codes) => activeTopics(activations).filter(({ topicCode }) => codes.includes(topicCode));

function questionGroup(type, stage, targetEntityId) {
  const target = targetEntityId || "customer";
  if (stage === "CONTROL") {
    if (type.includes("BOARD")) return `control:board:${target}`;
    if (type.includes("INFLUENCE") || type.includes("INFLUENTIAL")) return `control:influence:${target}`;
    return `control:voting:${target}`;
  }
  if (stage === "FALLBACK") return `fallback:senior-management:${target}`;
  if (type.includes("BEARER")) return `ownership:bearer:${target}`;
  if (type.includes("TRUST")) return `ownership:trust:${target}`;
  if (type.includes("LAYER")) return `ownership:layer:${target}`;
  if (stage === "ADDITIONAL") return `additional:${target}`;
  return `ownership:topic:${target}`;
}

function requirement(type, {
  stage, reason, originType, targetEntityId, targetPersonId, scope = "CUSTOMER_ENTITY", topicActivations = [], role, prompt, explanation, questionType = "FREE_TEXT", questionOptions,
}) {
  const semanticKey = semanticFactKey(type, { targetEntityId, targetPersonId, scope });
  const originTypes = [originType];
  if (topicActivations.length && originType !== QUESTION_ORIGIN.ANALYST_TOPIC) originTypes.push(QUESTION_ORIGIN.ANALYST_TOPIC);
  return {
    id: `fact-requirement:${semanticKey}`,
    comparisonItemId: questionGroup(type, stage, targetEntityId),
    type,
    semanticKey,
    stage,
    reason,
    status: "OPEN",
    originTypes,
    topicActivationIds: topicActivations.map(({ id }) => id),
    comparisonItemIds: [],
    ...(targetEntityId ? { targetEntityId } : {}),
    ...(targetPersonId ? { targetPersonId } : {}),
    ...(role ? { role } : {}),
    question: { prompt, explanation, type: questionType, ...(questionOptions ? { options: questionOptions } : {}) },
  };
}

function addQuestionMetadata(question, item, answer, now, status) {
  return {
    id: questionId(item), factRequirementId: item.id, comparisonItemId: item.comparisonItemId || item.semanticKey,
    semanticKey: item.semanticKey, originTypes: item.originTypes || [], comparisonItemIds: item.comparisonItemIds || [], topicActivationIds: item.topicActivationIds || [],
    targetEntityId: item.targetEntityId, targetPersonId: item.targetPersonId, stage: item.stage,
    ...item.question, status, createdAt: now, ...(answer ? { answeredAt: answer.answeredAt || now } : {}),
  };
}

function baseOwnershipSummary(base, comparisonRows) {
  const ownershipResolutions = base.resolutions.filter(({ comparisonItemId }) => comparisonItemId !== "ownership-comparison:nominee-declaration");
  const nominee = base.resolutions.find(({ comparisonItemId }) => comparisonItemId === "ownership-comparison:nominee-declaration");
  const pendingEvidence = base.evidenceRequirements.some(({ status }) => status !== "SATISFIED");
  const unresolved = ownershipResolutions.some(({ resolutionStatus }) => resolutionStatus === "UNRESOLVED") || (!nominee || nominee.resolutionStatus === "UNRESOLVED");
  const review = ownershipResolutions.some(({ resolutionStatus }) => resolutionStatus === "REQUIRES_ANALYST_REVIEW") || nominee?.resolutionStatus === "REQUIRES_ANALYST_REVIEW";
  const definite = ownershipResolutions.filter(({ uboImpact, comparisonItemId }) => {
    if (uboImpact?.determination !== "DEFINITE_UBO") return false;
    const row = comparisonRows.find(({ key }) => key === comparisonItemId);
    const subject = row?.chartFact?.subject || row?.researchFact?.subject;
    return subject?.entityType === "NATURAL_PERSON";
  }).map(({ comparisonItemId }) => {
    const row = comparisonRows.find(({ key }) => key === comparisonItemId);
    const subject = row?.chartFact?.subject || row?.researchFact?.subject;
    return { personId: subject?.entityId || safe(subject?.name), personName: subject?.name, bases: [UBO_BASIS.SHARE_OWNERSHIP], determination: "DEFINITE_UBO", idvRequired: true };
  });
  const status = pendingEvidence ? OWNERSHIP_RESOLUTION_STATUS.EVIDENCE_REQUIRED : review ? OWNERSHIP_RESOLUTION_STATUS.CONFLICTED : unresolved ? OWNERSHIP_RESOLUTION_STATUS.INDETERMINATE : OWNERSHIP_RESOLUTION_STATUS.COMPLETE;
  return { status, naturalPersonUboCount: definite.length, ubos: definite };
}

function addBooleanRoute(requirements, type, stage, reason, originType, activations, prompt, explanation, targetEntityId) {
  requirements.push(requirement(type, { stage, reason, originType, topicActivations: activations, targetEntityId, prompt, explanation, questionType: "SINGLE_SELECT", questionOptions: YES_NO_UNSURE }));
}

function deriveSpecialTopicRequirements(requirements, activations, answers, targetEntityId) {
  const addRoot = (code, type, prompt, explanation) => {
    const related = activationsFor(activations, code);
    if (!related.length) return null;
    addBooleanRoute(requirements, type, "OWNERSHIP", "ANALYST_TOPIC_ACTIVATED", QUESTION_ORIGIN.ANALYST_TOPIC, related, prompt, explanation, targetEntityId);
    return requirements[requirements.length - 1];
  };
  if (hasTopic(activations, INVESTIGATION_TOPIC_CODE.CURRENT_OWNERSHIP)) addBooleanRoute(requirements, TYPE.CONFIRM_CURRENT_OWNERSHIP, "OWNERSHIP", "ANALYST_TOPIC_ACTIVATED", QUESTION_ORIGIN.ANALYST_TOPIC, activationsFor(activations, INVESTIGATION_TOPIC_CODE.CURRENT_OWNERSHIP), "Is the ownership information provided the current ownership position?", "Confirm this for the company under review. If it has changed, we will ask for the effective position and evidence.", targetEntityId);
  const discrepancyActs = activationsFor(activations, INVESTIGATION_TOPIC_CODE.OWNERSHIP_DISCREPANCY);
  if (discrepancyActs.length && !requirements.some(({ type }) => type === "EXPLAIN_OWNERSHIP_DIFFERENCE")) addBooleanRoute(requirements, "EXPLAIN_OWNERSHIP_DIFFERENCE", "OWNERSHIP", "ANALYST_TOPIC_ACTIVATED", QUESTION_ORIGIN.ANALYST_TOPIC, discrepancyActs, "Is any ownership information materially different from the current position?", "If yes, describe the current position in the next ownership follow-up or provide supporting evidence.", targetEntityId);
  const exactActs = activationsFor(activations, INVESTIGATION_TOPIC_CODE.EXACT_OWNERSHIP_PERCENTAGE);
  if (exactActs.length && !requirements.some(({ type }) => type === "EXACT_SHARE_PERCENTAGE")) requirements.push(requirement("EXACT_SHARE_PERCENTAGE", { stage: "OWNERSHIP", reason: "ANALYST_TOPIC_ACTIVATED", originType: QUESTION_ORIGIN.ANALYST_TOPIC, topicActivations: exactActs, targetEntityId, prompt: "Which owner needs an exact ownership percentage confirmed, and what is that percentage?", explanation: "Provide the owner and exact current percentage. The analyst will map this answer to the relevant ownership relationship." }));
  const changeActs = activationsFor(activations, INVESTIGATION_TOPIC_CODE.OWNERSHIP_CHANGE);
  if (changeActs.length && !requirements.some(({ type }) => type === "OWNERSHIP_CHANGE_OCCURRED")) addBooleanRoute(requirements, "OWNERSHIP_CHANGE_OCCURRED", "OWNERSHIP", "ANALYST_TOPIC_ACTIVATED", QUESTION_ORIGIN.ANALYST_TOPIC, changeActs, "Has the company's ownership changed since the ownership information was prepared?", "If yes, provide the current position and effective date in the follow-up requested by the analyst.", targetEntityId);
  const layerActs = activationsFor(activations, INVESTIGATION_TOPIC_CODE.LAYER_QUALIFIER);
  if (layerActs.length) requirements.push(requirement(TYPE.IDENTIFY_LAYER_QUALIFIER, { stage: "OWNERSHIP", reason: "ANALYST_TOPIC_ACTIVATED", originType: QUESTION_ORIGIN.ANALYST_TOPIC, topicActivations: layerActs, targetEntityId, prompt: "What role does the selected party play in this ownership structure?", explanation: "Choose the role that best describes how the party appears in this ownership layer.", questionType: "SINGLE_SELECT", questionOptions: options(["DIRECT_SHAREHOLDER", "Direct shareholder"], ["INTERMEDIATE_HOLDING_COMPANY", "Intermediate holding company"], ["NOMINEE", "Nominee"], ["TRUSTEE", "Trustee"], ["TRUST", "Trust"], ["INVESTMENT_VEHICLE", "Investment vehicle"], ["PARTNERSHIP_OR_LLP", "Partnership or LLP"], ["OTHER", "Other"], ["UNKNOWN", "Unknown"]) }));
  const layer = requirements.find(({ type }) => type === TYPE.IDENTIFY_LAYER_QUALIFIER);
  const layerValue = layer && answerFor(layer, answers)?.value;
  const nomineeActs = activationsFor(activations, INVESTIGATION_TOPIC_CODE.NOMINEE_ARRANGEMENT);
  if (layerValue === "NOMINEE" && !nomineeActs.length) nomineeActs.push(...layerActs);
  if (nomineeActs.length) addBooleanRoute(requirements, "CONFIRM_NOMINEE_ARRANGEMENT", "OWNERSHIP", "ANALYST_TOPIC_ACTIVATED", QUESTION_ORIGIN.ANALYST_TOPIC, nomineeActs, "Does any shareholder shown in the ownership structure hold shares or ownership rights on behalf of another person or organisation?", "If yes, we will ask who holds the interest, for whom it is held and what interest is involved.", undefined);

  const bearer = addRoot(INVESTIGATION_TOPIC_CODE.BEARER_SHARES, TYPE.CONFIRM_BEARER_SHARES, "Does this company have any shares or share warrants held in bearer form?", "Bearer interests are controlled through possession rather than a named registered holder.");
  if (answerFor(bearer, answers)?.value === "YES") {
    const common = { stage: "OWNERSHIP", reason: "BEARER_INTEREST_DECLARED", originType: QUESTION_ORIGIN.ANALYST_TOPIC, topicActivations: activationsFor(activations, INVESTIGATION_TOPIC_CODE.BEARER_SHARES), targetEntityId };
    requirements.push(requirement(TYPE.IDENTIFY_BEARER_ENTITY, { ...common, prompt: "Which entity issued the bearer shares or warrants?", explanation: "Enter the legal name of the relevant entity." }));
    requirements.push(requirement(TYPE.IDENTIFY_BEARER_INTEREST, { ...common, prompt: "What share class or interest is held in bearer form?", explanation: "Describe the class, warrant or other interest." }));
    requirements.push(requirement(TYPE.IDENTIFY_BEARER_CONTROLLER, { ...common, prompt: "Who currently possesses or controls the bearer interest?", explanation: "Enter the individual or organisation that has practical control." }));
    requirements.push(requirement(TYPE.IDENTIFY_BEARER_CUSTODIAN, { ...common, prompt: "Is a custodian involved? If yes, provide its name.", explanation: "Enter No if there is no custodian." }));
  }
  const trustActs = activationsFor(activations, INVESTIGATION_TOPIC_CODE.TRUST_OR_TRUSTEE_INVOLVEMENT);
  if (["TRUST", "TRUSTEE"].includes(layerValue) && !trustActs.length) trustActs.push(...layerActs);
  let trust = null;
  if (trustActs.length) {
    addBooleanRoute(requirements, TYPE.CONFIRM_TRUST_INVOLVEMENT, "OWNERSHIP", "ANALYST_TOPIC_ACTIVATED", QUESTION_ORIGIN.ANALYST_TOPIC, trustActs, "Is any ownership interest shown in the structure held through a trust or by a trustee?", "This discovery step collects trust parties for analyst review; it does not make a trust UBO determination.", targetEntityId);
    trust = requirements[requirements.length - 1];
  }
  if (answerFor(trust, answers)?.value === "YES") {
    const common = { stage: "OWNERSHIP", reason: "TRUST_INVOLVEMENT_DECLARED", originType: QUESTION_ORIGIN.ANALYST_TOPIC, topicActivations: trustActs, targetEntityId };
    requirements.push(requirement(TYPE.IDENTIFY_TRUST_SHAREHOLDER, { ...common, prompt: "Which shareholder or ownership interest is connected to the trust?", explanation: "Identify the relevant party shown in the structure." }));
    requirements.push(requirement(TYPE.IDENTIFY_TRUST_NAME, { ...common, prompt: "What is the name of the trust?", explanation: "Use the name stated in the trust or ownership records." }));
    requirements.push(requirement(TYPE.IDENTIFY_TRUSTEES, { ...common, prompt: "Who are the trustees?", explanation: "You can enter more than one name, separated by commas." }));
    requirements.push(requirement(TYPE.IDENTIFY_TRUST_PARTIES, { ...common, prompt: "Who else is relevant to the trust arrangement?", explanation: "Where known, identify the settlor, beneficiaries or beneficiary class, protector and any other person exercising control." }));
  }
}

function controlRequirements({ requirements, answers, activations, ownership, mode, targetEntityId }) {
  const allControlActivations = activeTopics(activations).filter(({ topicCode }) => [INVESTIGATION_TOPIC_CODE.CONTROL_DISCOVERY, INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS, INVESTIGATION_TOPIC_CODE.BOARD_APPOINTMENT_OR_REMOVAL_RIGHTS, INVESTIGATION_TOPIC_CODE.OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL].includes(topicCode));
  const ownershipEstablishedAfterActivation = ownership.naturalPersonUboCount > 0 && allControlActivations.length > 0 && allControlActivations.every((activation) => Object.values(answers).some(({ answeredAt }) => answeredAt && activation.createdAt && answeredAt > activation.createdAt));
  const availableManual = ownershipEstablishedAfterActivation && mode === CONTROL_DISCOVERY_MODE.OWNERSHIP_FIRST_THEN_CONTROL ? [] : allControlActivations;
  const manualAll = activationsFor(availableManual, INVESTIGATION_TOPIC_CODE.CONTROL_DISCOVERY);
  const manualVoting = activationsFor(availableManual, INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS);
  const manualBoard = activationsFor(availableManual, INVESTIGATION_TOPIC_CODE.BOARD_APPOINTMENT_OR_REMOVAL_RIGHTS);
  const manualInfluence = activationsFor(availableManual, INVESTIGATION_TOPIC_CODE.OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL);
  const auto = mode === CONTROL_DISCOVERY_MODE.OWNERSHIP_AND_CONTROL_IN_PARALLEL || (ownership.status === OWNERSHIP_RESOLUTION_STATUS.COMPLETE && ownership.naturalPersonUboCount === 0);
  const progressive = auto || manualAll.length > 0;
  const origin = auto ? QUESTION_ORIGIN.SYSTEM_CONTROL_DISCOVERY : QUESTION_ORIGIN.ANALYST_TOPIC;
  const votingActive = auto || manualAll.length > 0 || manualVoting.length > 0;
  const boardForced = manualBoard.length > 0;
  const influenceForced = manualInfluence.length > 0;
  const assessment = [];
  let votingResolvedNo = false;
  let votingResolvedWithoutUbo = false;
  let boardResolvedNo = false;
  let influenceResolvedNo = false;
  if (votingActive) {
    addBooleanRoute(requirements, TYPE.IDENTIFY_SIGNIFICANT_VOTING_RIGHT_HOLDER, "CONTROL", auto ? "OWNERSHIP_COMPLETE_WITHOUT_NATURAL_PERSON_UBO" : "ANALYST_TOPIC_ACTIVATED", origin, [...manualAll, ...manualVoting], "Does any individual have significant voting rights in the company that are different from, or not clear from, the share ownership information already provided?", "This may happen where different share classes or agreements give someone voting rights that differ from their economic shareholding.", targetEntityId);
    const root = requirements[requirements.length - 1];
    const rootValue = answerFor(root, answers)?.value;
    votingResolvedNo = rootValue === "NO";
    if (rootValue === "YES") {
      const common = { stage: "CONTROL", reason: "SIGNIFICANT_VOTING_RIGHTS_DECLARED", originType: origin, topicActivations: [...manualAll, ...manualVoting], targetEntityId };
      const holders = requirement(TYPE.IDENTIFY_VOTING_RIGHT_HOLDERS, { ...common, prompt: "Who has those voting rights?", explanation: "Enter each individual's full name, separated by commas if there is more than one." });
      requirements.push(holders);
      const holderNames = names(answerFor(holders, answers)?.value);
      holderNames.forEach((personName) => requirements.push(requirement(TYPE.ESTABLISH_VOTING_RIGHT_PERCENTAGE, { ...common, targetPersonId: safe(personName), role: personName, prompt: `What percentage of the company's voting rights can ${personName} exercise or control?`, explanation: "Enter the direct or indirect percentage known for this individual.", questionType: "PERCENTAGE" })));
      const votingPercentageRequirements = requirements.filter(({ type }) => type === TYPE.ESTABLISH_VOTING_RIGHT_PERCENTAGE);
      votingPercentageRequirements.forEach((item) => {
        const value = Number(answerFor(item, answers)?.value);
        if (!Number.isFinite(value)) return;
        assessment.push({ personId: item.targetPersonId, personName: item.role, customerEntityId: targetEntityId, basis: UBO_BASIS.VOTING_RIGHTS, percentage: value, directness: "UNKNOWN", policyId: "uk-ubo-control", policyVersion: "1.0", evidenceStatus: "ASSERTED", outcome: value >= 25 ? CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO : CONTROL_ASSESSMENT_OUTCOME.NOT_CONTROL_UBO });
      });
      votingResolvedWithoutUbo = holderNames.length > 0
        && votingPercentageRequirements.length === holderNames.length
        && votingPercentageRequirements.every((item) => Number.isFinite(Number(answerFor(item, answers)?.value)))
        && !assessment.some(({ outcome }) => outcome === CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO);
    }
  }
  const controlUbo = () => assessment.some(({ outcome }) => outcome === CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO);
  const votingRouteResolvedWithoutUbo = votingResolvedNo || votingResolvedWithoutUbo;
  if (!controlUbo() && (boardForced || (progressive && votingActive && votingRouteResolvedWithoutUbo))) {
    const acts = [...manualAll, ...manualBoard];
    addBooleanRoute(requirements, TYPE.IDENTIFY_BOARD_APPOINTMENT_CONTROL, "CONTROL", boardForced ? "ANALYST_TOPIC_ACTIVATED" : "VOTING_RIGHTS_ROUTE_RESOLVED_WITHOUT_UBO", boardForced ? QUESTION_ORIGIN.ANALYST_TOPIC : origin, acts, "Does any individual have the right to appoint or remove a majority of the company's directors or equivalent governing body?", "Consider rights in the articles, shareholder agreements, investor rights or another governing arrangement.", targetEntityId);
    const root = requirements[requirements.length - 1];
    const value = answerFor(root, answers)?.value;
    boardResolvedNo = value === "NO";
    if (value === "YES") {
      const common = { stage: "CONTROL", reason: "BOARD_CONTROL_DECLARED", originType: boardForced ? QUESTION_ORIGIN.ANALYST_TOPIC : origin, topicActivations: acts, targetEntityId };
      const holder = requirement(TYPE.IDENTIFY_BOARD_CONTROLLER, { ...common, prompt: "Who has this right?", explanation: "Enter each individual's full name, separated by commas if there is more than one." });
      requirements.push(holder);
      names(answerFor(holder, answers)?.value).forEach((personName) => requirements.push(requirement(TYPE.ESTABLISH_BOARD_CONTROL_RIGHT, { ...common, targetPersonId: safe(personName), role: personName, prompt: `What right does ${personName} have?`, explanation: "Choose the right that best describes the arrangement.", questionType: "SINGLE_SELECT", questionOptions: options(["APPOINT_MAJORITY", "Appoint a majority of directors"], ["REMOVE_MAJORITY", "Remove a majority of directors"], ["APPOINT_AND_REMOVE_MAJORITY", "Appoint and remove a majority"], ["EQUIVALENT_GOVERNING_BODY_CONTROL", "Equivalent control over the governing body"], ["OTHER", "Other"]) })));
      requirements.filter(({ type }) => type === TYPE.ESTABLISH_BOARD_CONTROL_RIGHT).forEach((item) => {
        const right = answerFor(item, answers)?.value;
        if (!right) return;
        assessment.push({ personId: item.targetPersonId, personName: item.role, customerEntityId: targetEntityId, basis: UBO_BASIS.BOARD_CONTROL, controlRight: right, policyId: "uk-ubo-control", policyVersion: "1.0", evidenceStatus: right === "OTHER" ? "ANALYST_REVIEW" : "ASSERTED", outcome: right === "OTHER" ? CONTROL_ASSESSMENT_OUTCOME.INDETERMINATE : CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO });
      });
    }
  }
  if (!controlUbo() && (influenceForced || (progressive && boardResolvedNo && (votingRouteResolvedWithoutUbo || !votingActive)))) {
    const acts = [...manualAll, ...manualInfluence];
    addBooleanRoute(requirements, TYPE.IDENTIFY_SIGNIFICANT_INFLUENCE, "CONTROL", influenceForced ? "ANALYST_TOPIC_ACTIVATED" : "FORMAL_CONTROL_ROUTES_RESOLVED_WITHOUT_UBO", influenceForced ? QUESTION_ORIGIN.ANALYST_TOPIC : origin, acts, "Is there any individual who can direct or strongly influence important decisions of the company even though this is not clear from their shareholding or voting percentage?", "Examples include deciding or vetoing important business decisions, determining strategy, controlling major borrowing or exercising decisive influence over the board.", targetEntityId);
    const root = requirements[requirements.length - 1];
    const value = answerFor(root, answers)?.value;
    influenceResolvedNo = value === "NO";
    if (value === "YES") {
      const common = { stage: "CONTROL", reason: "SIGNIFICANT_INFLUENCE_DECLARED", originType: influenceForced ? QUESTION_ORIGIN.ANALYST_TOPIC : origin, topicActivations: acts, targetEntityId };
      const holder = requirement(TYPE.IDENTIFY_INFLUENTIAL_PERSON, { ...common, prompt: "Who is the individual?", explanation: "Enter each individual's full name, separated by commas if there is more than one." });
      requirements.push(holder);
      names(answerFor(holder, answers)?.value).forEach((personName) => {
        requirements.push(requirement(TYPE.ESTABLISH_INFLUENCE_TYPE, { ...common, targetPersonId: safe(personName), role: personName, prompt: `How does ${personName} exercise this influence or control?`, explanation: "Choose the closest structured description.", questionType: "SINGLE_SELECT", questionOptions: options(["DECISION_RIGHTS", "Decision rights"], ["VETO_RIGHTS", "Veto rights"], ["BOARD_INFLUENCE", "Influence over the board"], ["SHAREHOLDER_VOTING_INFLUENCE", "Shareholder voting influence"], ["CONTRACTUAL_RIGHTS", "Contractual rights"], ["POWER_OF_ATTORNEY", "Power of attorney"], ["INFORMAL_ARRANGEMENT", "Informal arrangement"], ["OTHER", "Other"]) }));
        requirements.push(requirement(TYPE.EXPLAIN_SIGNIFICANT_INFLUENCE, { ...common, targetPersonId: safe(personName), role: personName, prompt: `Explain how ${personName}'s influence works in practice.`, explanation: "Describe the important decisions affected and how the person's views or instructions are followed." }));
      });
      requirements.filter(({ type }) => type === TYPE.ESTABLISH_INFLUENCE_TYPE).forEach((item) => {
        const influenceType = answerFor(item, answers)?.value;
        const explanation = requirements.find(({ type, targetPersonId }) => type === TYPE.EXPLAIN_SIGNIFICANT_INFLUENCE && targetPersonId === item.targetPersonId);
        if (!influenceType || !answerFor(explanation, answers)?.value) return;
        assessment.push({ personId: item.targetPersonId, personName: item.role, customerEntityId: targetEntityId, basis: UBO_BASIS.SIGNIFICANT_INFLUENCE, controlType: influenceType, explanation: answerFor(explanation, answers).value, policyId: "uk-ubo-control", policyVersion: "1.0", evidenceStatus: "ANALYST_REVIEW", outcome: CONTROL_ASSESSMENT_OUTCOME.INDETERMINATE });
      });
    }
  }
  const uncertain = requirements.some((item) => item.stage === "CONTROL" && answerFor(item, answers)?.value === "NOT_SURE") || assessment.some(({ outcome }) => outcome === CONTROL_ASSESSMENT_OUTCOME.INDETERMINATE);
  const manualSpecificComplete = !auto && !manualAll.length && (manualVoting.length || manualBoard.length || manualInfluence.length)
    && (!manualVoting.length || votingRouteResolvedWithoutUbo)
    && (!manualBoard.length || boardResolvedNo || assessment.some(({ basis, outcome }) => basis === UBO_BASIS.BOARD_CONTROL && outcome === CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO))
    && (!manualInfluence.length || influenceResolvedNo);
  const status = controlUbo() || influenceResolvedNo || manualSpecificComplete ? CONTROL_RESOLUTION_STATUS.COMPLETE : uncertain ? CONTROL_RESOLUTION_STATUS.ANALYST_REVIEW : requirements.some(({ stage }) => stage === "CONTROL") ? CONTROL_RESOLUTION_STATUS.IN_PROGRESS : CONTROL_RESOLUTION_STATUS.NOT_STARTED;
  return { assessments: assessment, status, uboCount: assessment.filter(({ outcome }) => outcome === CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO).length, exhausted: influenceResolvedNo };
}

function seniorRequirements(requirements, answers, activations, ownership, control, targetEntityId) {
  const manual = activationsFor(activations, INVESTIGATION_TOPIC_CODE.SENIOR_MANAGING_OFFICIAL);
  const automatic = ownership.status === OWNERSHIP_RESOLUTION_STATUS.COMPLETE && ownership.naturalPersonUboCount === 0 && control.status === CONTROL_RESOLUTION_STATUS.COMPLETE && control.uboCount === 0 && control.exhausted;
  if (!automatic && !manual.length) return { outcome: null, people: [], reason: null };
  const originType = automatic ? QUESTION_ORIGIN.SYSTEM_FALLBACK : QUESTION_ORIGIN.ANALYST_TOPIC;
  const people = requirement(TYPE.IDENTIFY_SENIOR_MANAGING_OFFICIAL, { stage: "FALLBACK", reason: automatic ? "OWNERSHIP_AND_CONTROL_ROUTES_EXHAUSTED" : "ANALYST_TOPIC_ACTIVATED", originType, topicActivations: manual, targetEntityId, prompt: automatic ? "We have not been able to identify an individual who ultimately owns or controls the company. Who is the most senior person, or persons, responsible for the company's overall management and key strategic decisions?" : "Who is the most senior person, or persons, responsible for the company's overall management and key strategic decisions?", explanation: "Enter the person or people to whom significant decisions are escalated and who have authority to direct the company's overall activities. Separate multiple names with commas." });
  requirements.push(people);
  const officials = names(answerFor(people, answers)?.value);
  officials.forEach((personName) => {
    requirements.push(requirement(TYPE.IDENTIFY_SENIOR_MANAGEMENT_ROLE, { stage: "FALLBACK", reason: "SENIOR_MANAGER_IDENTIFIED", originType, topicActivations: manual, targetEntityId, targetPersonId: safe(personName), role: personName, prompt: `What is ${personName}'s role or title?`, explanation: "Examples include CEO, Managing Director, Executive Director, executive Chair, General Manager, Partner or another senior decision maker. Title alone does not establish the fallback role." }));
    requirements.push(requirement(TYPE.ESTABLISH_SENIOR_MANAGEMENT_AUTHORITY, { stage: "FALLBACK", reason: "SENIOR_MANAGER_IDENTIFIED", originType, topicActivations: manual, targetEntityId, targetPersonId: safe(personName), role: personName, prompt: `Which best describes ${personName}'s authority?`, explanation: "Select based on practical authority, not title alone.", questionType: "SINGLE_SELECT", questionOptions: options(["DAY_TO_DAY_MANAGEMENT", "Overall day-to-day management"], ["FINAL_MAJOR_DECISIONS", "Final authority over major business decisions"], ["STRATEGIC_DIRECTION", "Responsible for strategic direction"], ["ESCALATION_AUTHORITY", "Key decisions are normally escalated to this person"], ["COLLECTIVE_MANAGEMENT", "Member of a management group that collectively exercises these responsibilities"], ["OTHER", "Other"]) }));
  });
  const identified = officials.filter((personName) => {
    const authority = requirements.find(({ type, targetPersonId }) => type === TYPE.ESTABLISH_SENIOR_MANAGEMENT_AUTHORITY && targetPersonId === safe(personName));
    const role = requirements.find(({ type, targetPersonId }) => type === TYPE.IDENTIFY_SENIOR_MANAGEMENT_ROLE && targetPersonId === safe(personName));
    return Boolean(answerFor(authority, answers)?.value && answerFor(role, answers)?.value);
  }).map((personName) => ({ personId: safe(personName), personName, role: answerFor(requirements.find(({ type, targetPersonId }) => type === TYPE.IDENTIFY_SENIOR_MANAGEMENT_ROLE && targetPersonId === safe(personName)), answers).value, authority: answerFor(requirements.find(({ type, targetPersonId }) => type === TYPE.ESTABLISH_SENIOR_MANAGEMENT_AUTHORITY && targetPersonId === safe(personName)), answers).value, entityId: targetEntityId, cddIdentityVerificationRequired: true }));
  return {
    outcome: identified.length && identified.length === officials.length ? "FALLBACK_SENIOR_MANAGING_OFFICIAL_IDENTIFIED" : "FALLBACK_SENIOR_MANAGING_OFFICIAL_REQUIRED",
    people: identified,
    reason: automatic ? "No natural-person UBO was established after direct ownership, indirect ownership, voting rights, board appointment/removal rights and other significant influence/control were assessed." : "Senior-management fallback was activated manually by an analyst.",
  };
}

function customRequirements(requirements, analystCustomerRequests, targetEntityId) {
  analystCustomerRequests.forEach((request) => requirements.push(requirement(TYPE.ANALYST_CUSTOM, { stage: "ADDITIONAL", reason: "ANALYST_CUSTOM_REQUEST", originType: QUESTION_ORIGIN.ANALYST_CUSTOM, targetEntityId, scope: request.requestId || request.informationNeedId, prompt: request.question || request.title || "Please provide the requested information.", explanation: request.scope || request.title || "This question was added by the reviewing analyst." })));
}

function mergeUboAssessments(ownership, control) {
  const people = new Map();
  [...ownership.ubos, ...control.assessments.filter(({ outcome }) => outcome === CONTROL_ASSESSMENT_OUTCOME.CONTROL_UBO)].forEach((item) => {
    const key = safe(item.personName || item.personId);
    const existing = people.get(key) || { personId: key, personName: item.personName, determination: "DEFINITE_UBO", bases: [], idvRequired: true };
    existing.bases = [...new Set([...existing.bases, ...(item.bases || [item.basis])])];
    people.set(key, existing);
  });
  return [...people.values()];
}

function discoveryEvidenceRecord(item, ruleKey, now) {
  const rule = DISCOVERY_EVIDENCE[ruleKey];
  return {
    id: `evidence-requirement:${item.semanticKey}:${ruleKey}`,
    comparisonItemId: item.comparisonItemId,
    factRequirementId: item.id,
    purpose: rule.purpose,
    preferredEvidenceTypes: rule.preferred,
    alternativeEvidenceTypes: rule.alternative,
    status: "OPEN",
    createdAt: now,
    reviewMode: "ANALYST_REVIEW",
    handoff: {
      contractVersion: "ubo-external-evidence-handoff-v1", handoffType: "EXTERNAL_EVIDENCE_REQUIRED", status: "PENDING_EXTERNAL_ACTION",
      semanticEvidenceCategories: [...rule.preferred, ...rule.alternative], requestedConcepts: [ruleKey], requestDoesNotResolveInformationNeed: true,
      acceptsFileBytes: false, createsEvidenceArtifact: false, executionConnected: true, executionRoute: "/api/ubo-demo-customer-ownership-chart",
    },
  };
}

function discoveryEvidenceRequirements(requirements, answers, control, now) {
  const records = [];
  const withAnswer = (type) => requirements.find((item) => item.type === type && answerFor(item, answers)?.value);
  if (control.assessments.some(({ basis }) => basis === UBO_BASIS.VOTING_RIGHTS)) records.push(discoveryEvidenceRecord(withAnswer(TYPE.ESTABLISH_VOTING_RIGHT_PERCENTAGE), "VOTING_RIGHTS", now));
  if (control.assessments.some(({ basis }) => basis === UBO_BASIS.BOARD_CONTROL)) records.push(discoveryEvidenceRecord(withAnswer(TYPE.ESTABLISH_BOARD_CONTROL_RIGHT), "BOARD_CONTROL", now));
  if (control.assessments.some(({ basis }) => basis === UBO_BASIS.SIGNIFICANT_INFLUENCE)) records.push(discoveryEvidenceRecord(withAnswer(TYPE.EXPLAIN_SIGNIFICANT_INFLUENCE), "SIGNIFICANT_INFLUENCE", now));
  const bearer = withAnswer(TYPE.CONFIRM_BEARER_SHARES);
  if (answerFor(bearer, answers)?.value === "YES" && withAnswer(TYPE.IDENTIFY_BEARER_CONTROLLER)) records.push(discoveryEvidenceRecord(withAnswer(TYPE.IDENTIFY_BEARER_CONTROLLER), "BEARER", now));
  const trust = withAnswer(TYPE.CONFIRM_TRUST_INVOLVEMENT);
  if (answerFor(trust, answers)?.value === "YES" && withAnswer(TYPE.IDENTIFY_TRUSTEES)) records.push(discoveryEvidenceRecord(withAnswer(TYPE.IDENTIFY_TRUSTEES), "TRUST", now));
  return records.filter(Boolean);
}

export function extendResolutionWithInvestigation({ base, comparisonRows = [], answers = {}, evidence = {}, topicActivations = [], analystCustomerRequests = [], ownershipContext = {}, controlDiscoveryMode = CONTROL_DISCOVERY_MODE.OWNERSHIP_FIRST_THEN_CONTROL, customerEntityId = "CUSTOMER_ENTITY", now }) {
  let ownership = baseOwnershipSummary(base, comparisonRows);
  const decoratedBase = base.requirements.map((item) => ({
    ...item,
    semanticKey: semanticFactKey(item.type, {
      targetEntityId: item.comparisonItemId === "ownership-comparison:nominee-declaration" ? undefined : item.comparisonItemId,
      targetPersonId: item.role || undefined,
      scope: item.comparisonItemId === "ownership-comparison:nominee-declaration" ? "CUSTOMER_ENTITY" : "COMPARISON_ITEM",
    }),
    originTypes: [QUESTION_ORIGIN.SYSTEM_COMPARISON], comparisonItemIds: [item.comparisonItemId], topicActivationIds: [], stage: "OWNERSHIP",
  }));
  const requirements = [...decoratedBase];
  activeTopics(topicActivations).forEach((activation) => {
    const roots = topicDefinition(activation.topicCode)?.rootFactTypes || [];
    requirements.filter(({ type }) => roots.includes(type)).forEach((item) => {
      item.originTypes = [...new Set([...(item.originTypes || []), QUESTION_ORIGIN.ANALYST_TOPIC])];
      item.topicActivationIds = [...new Set([...(item.topicActivationIds || []), activation.id])];
    });
  });
  if (comparisonRows.some(({ status }) => status === "CONFLICT") && !ownershipContext.customerDocumentEffectiveDate) {
    addBooleanRoute(requirements, TYPE.CONFIRM_CURRENT_OWNERSHIP, "OWNERSHIP", "MATERIAL_DISCREPANCY_AND_CUSTOMER_DOCUMENT_DATE_UNCLEAR", QUESTION_ORIGIN.SYSTEM_COMPARISON, [], "Is the ownership information provided the current ownership position?", "We found a material difference from independent information and the ownership document does not state when this position became effective.", customerEntityId);
  }
  deriveSpecialTopicRequirements(requirements, topicActivations, answers, customerEntityId);
  const unresolvedSpecialOwnership = requirements.some((item) => item.stage === "OWNERSHIP" && item.question && !answerFor(item, answers));
  if (ownership.status === OWNERSHIP_RESOLUTION_STATUS.COMPLETE && unresolvedSpecialOwnership) ownership = { ...ownership, status: OWNERSHIP_RESOLUTION_STATUS.INDETERMINATE };
  const declaredTrust = requirements.find(({ type }) => type === TYPE.CONFIRM_TRUST_INVOLVEMENT);
  const declaredBearer = requirements.find(({ type }) => type === TYPE.CONFIRM_BEARER_SHARES);
  if (answerFor(declaredTrust, answers)?.value === "YES") ownership = { ...ownership, status: OWNERSHIP_RESOLUTION_STATUS.CONFLICTED };
  else if (answerFor(declaredBearer, answers)?.value === "YES") ownership = { ...ownership, status: OWNERSHIP_RESOLUTION_STATUS.EVIDENCE_REQUIRED };
  const control = controlRequirements({ requirements, answers, activations: topicActivations, ownership, mode: controlDiscoveryMode, targetEntityId: customerEntityId });
  const fallback = seniorRequirements(requirements, answers, topicActivations, ownership, control, customerEntityId);
  customRequirements(requirements, analystCustomerRequests, customerEntityId);
  requirements.forEach((item) => {
    const activation = topicActivations.find(({ id: activationId, wordingOverride }) => wordingOverride && item.topicActivationIds?.includes(activationId) && topicDefinition(item.topicCode || topicActivations.find(({ id }) => id === activationId)?.topicCode)?.rootFactTypes.includes(item.type));
    if (activation) item.question = { ...item.question, prompt: activation.wordingOverride };
  });
  const deduped = deduplicateFactRequirements(requirements);
  const discoveryEvidence = discoveryEvidenceRequirements(deduped, answers, control, now).map((record) => evidence[record.id] ? { ...record, ...evidence[record.id] } : record);
  const allEvidenceRequirements = [...base.evidenceRequirements, ...discoveryEvidence];
  const baseQuestionByRequirement = new Map(base.questions.map((item) => [item.factRequirementId, item]));
  const questions = deduped.filter(({ status }) => status !== "RESOLVED").map((item) => {
    const existing = baseQuestionByRequirement.get(item.id);
    const answer = answers[existing?.id || questionId(item)];
    if (existing) return { ...existing, semanticKey: item.semanticKey, originTypes: item.originTypes, comparisonItemIds: item.comparisonItemIds, topicActivationIds: item.topicActivationIds, stage: item.stage };
    return addQuestionMetadata(null, item, answer, now, answer ? "RESOLVED" : "OPEN");
  });
  const openQuestions = questions.filter(({ status }) => status === "OPEN");
  const topicStatuses = topicActivations.map((activation) => {
    const related = questions.filter(({ topicActivationIds = [] }) => topicActivationIds.includes(activation.id));
    const evidenceRequired = allEvidenceRequirements.some(({ factRequirementId }) => related.some(({ factRequirementId: id }) => id === factRequirementId));
    const analystReview = control.assessments.some(({ evidenceStatus }) => evidenceStatus === "ANALYST_REVIEW") && [INVESTIGATION_TOPIC_CODE.OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL, INVESTIGATION_TOPIC_CODE.CONTROL_DISCOVERY].includes(activation.topicCode);
    const status = analystReview ? "ANALYST_REVIEW" : evidenceRequired ? "EVIDENCE_REQUIRED" : related.some(({ status: state }) => state === "OPEN") ? "ASKING_CUSTOMER" : related.length ? "ANSWERED" : "SUPERSEDED";
    return { ...activation, displayStatus: status, reason: status === "SUPERSEDED" ? "No unresolved fact remains for this topic under the active policy." : activation.analystReason || activation.reason };
  });
  return {
    ...base,
    contractVersion: "ubo-ownership-resolution-state-v2",
    policy: { controlDiscoveryMode, policyId: "uk-ubo-discovery", policyVersion: "1.0" },
    requirements: deduped,
    questions,
    openQuestions,
    evidenceRequirements: allEvidenceRequirements,
    ownershipResolution: ownership,
    controlResolution: control,
    fallback,
    uboAssessments: mergeUboAssessments(ownership, control),
    topicActivations: topicStatuses,
    auditTrail: {
      ownershipRoutesAssessed: ownership.status === OWNERSHIP_RESOLUTION_STATUS.COMPLETE ? ["DIRECT_OWNERSHIP", "INDIRECT_OWNERSHIP", "OWNERSHIP_ISSUES_RESOLVED"] : [],
      controlRoutesAssessed: control.exhausted ? ["VOTING_RIGHTS", "BOARD_APPOINTMENT_OR_REMOVAL_RIGHTS", "OTHER_SIGNIFICANT_INFLUENCE_OR_CONTROL"] : [],
      fallbackReason: fallback.reason,
    },
  };
}
