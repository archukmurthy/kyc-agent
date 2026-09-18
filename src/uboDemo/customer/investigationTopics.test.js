import {
  createTopicActivation,
  deduplicateFactRequirements,
  INVESTIGATION_TOPIC_CODE,
  INVESTIGATION_TOPIC_REGISTRY,
  QUESTION_ORIGIN,
  semanticFactKey,
} from "./investigationTopics";

test("topic registry keeps future economic routes inactive", () => {
  expect(INVESTIGATION_TOPIC_REGISTRY.find(({ code }) => code === INVESTIGATION_TOPIC_CODE.ECONOMIC_INTEREST).active).toBe(false);
  expect(INVESTIGATION_TOPIC_REGISTRY.find(({ code }) => code === INVESTIGATION_TOPIC_CODE.VOTING_RIGHTS).active).toBe(true);
});

test("analyst activation is structured and target-aware", () => {
  expect(createTopicActivation({ topicCode: INVESTIGATION_TOPIC_CODE.NOMINEE_ARRANGEMENT, caseId: "case-1", targetEntityId: "company-1", createdAt: "2026-09-17T12:00:00.000Z" })).toEqual(expect.objectContaining({
    id: "topic-activation:NOMINEE_ARRANGEMENT:company-1",
    origin: "ANALYST",
    status: "ACTIVE",
  }));
});

test("canonical semantic keys merge automatic and analyst origins", () => {
  const semanticKey = semanticFactKey("CONFIRM_NOMINEE_ARRANGEMENT", { targetEntityId: "company-1" });
  const result = deduplicateFactRequirements([
    { id: "system", type: "CONFIRM_NOMINEE_ARRANGEMENT", semanticKey, originTypes: [QUESTION_ORIGIN.SYSTEM_COMPARISON], comparisonItemIds: ["nominee"] },
    { id: "analyst", type: "CONFIRM_NOMINEE_ARRANGEMENT", semanticKey, originTypes: [QUESTION_ORIGIN.ANALYST_TOPIC], topicActivationIds: ["activation-1"] },
  ]);
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual(expect.objectContaining({
    originTypes: [QUESTION_ORIGIN.SYSTEM_COMPARISON, QUESTION_ORIGIN.ANALYST_TOPIC],
    topicActivationIds: ["activation-1"],
  }));
});
