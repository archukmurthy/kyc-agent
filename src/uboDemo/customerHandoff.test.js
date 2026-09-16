import {
  CUSTOMER_HANDOFF_ACCEPTED,
  CUSTOMER_HANDOFF_CONTRACT,
  CUSTOMER_HANDOFF_DELIVERY,
  CUSTOMER_HANDOFF_READY,
  listenForCustomerHandoff,
} from "./customerHandoff";

test("customer receiver accepts the complete handoff only from its exact opener origin", () => {
  const listeners = {};
  const opener = { postMessage: jest.fn() };
  const windowRef = {
    location: { search: `?handoff=${CUSTOMER_HANDOFF_CONTRACT}&handoffOrigin=http%3A%2F%2Flocalhost%3A3000` },
    opener,
    addEventListener: jest.fn((name, listener) => { listeners[name] = listener; }),
    removeEventListener: jest.fn(),
  };
  const onHandoff = jest.fn();
  listenForCustomerHandoff(onHandoff, { windowRef });
  expect(opener.postMessage).toHaveBeenCalledWith({ type: CUSTOMER_HANDOFF_READY, contractVersion: CUSTOMER_HANDOFF_CONTRACT }, "http://localhost:3000");
  const payload = {
    contractVersion: CUSTOMER_HANDOFF_CONTRACT,
    demoCase: { demoCaseId: "demo-1", company: { legalName: "Target Ltd" } },
    researchResult: { candidateSources: [{ candidateFacts: [{ factId: "one" }, { factId: "two" }] }] },
  };
  listeners.message({ origin: "http://not-the-opener.example", source: opener, data: { type: CUSTOMER_HANDOFF_DELIVERY, payload } });
  expect(onHandoff).not.toHaveBeenCalled();
  listeners.message({ origin: "http://localhost:3000", source: opener, data: { type: CUSTOMER_HANDOFF_DELIVERY, payload } });
  expect(onHandoff).toHaveBeenCalledWith(payload);
  expect(opener.postMessage).toHaveBeenLastCalledWith({ type: CUSTOMER_HANDOFF_ACCEPTED, contractVersion: CUSTOMER_HANDOFF_CONTRACT }, "http://localhost:3000");
});
