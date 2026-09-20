import {
  buildCustomerHandoff,
  CUSTOMER_HANDOFF_ACCEPTED,
  CUSTOMER_HANDOFF_CONTRACT,
  CUSTOMER_HANDOFF_DELIVERY,
  CUSTOMER_HANDOFF_READY,
  listenForCustomerHandoff,
  openCustomerViewHandoff,
  resolveCustomerDemoUrl,
} from "./customerHandoff";

test("customer URL uses the consolidated same-host route and a configured deployment URL takes precedence", () => {
  expect(resolveCustomerDemoUrl({ protocol: "http:", hostname: "localhost", origin: "http://localhost:3000" }, "").href).toBe("http://localhost:3000/ubo-demo/customer/");
  expect(resolveCustomerDemoUrl({ protocol: "https:", hostname: "preview.example", origin: "https://preview.example" }, "https://customer.example/ubo-demo/").href).toBe("https://customer.example/ubo-demo/");
  expect(resolveCustomerDemoUrl({ protocol: "https:", hostname: "preview.example", origin: "https://preview.example" }, "").href).toBe("https://preview.example/ubo-demo/customer/");
});

test("handoff keeps every normalized source assertion out of the URL and delivers it only after an exact-origin ready signal", async () => {
  const candidateSources = [{ sourceRecordId: "source-1", candidateFacts: [{ factId: "fact-1" }, { factId: "fact-2" }] }];
  const analystCustomerRequests = [{ requestId: "request-need-1", informationNeedId: "need-1", title: "Trust status", question: "Is a trust present?" }];
  const payload = buildCustomerHandoff({
    draft: { legalName: "Target Ltd" },
    demoCase: { demoCaseId: "demo-1", company: { legalName: "Target Ltd" } },
    researchResult: { candidateSources, analystCustomerRequests },
  }, () => "2026-09-16T12:00:00.000Z");
  expect(payload.researchResult.candidateSources).toBe(candidateSources);
  expect(payload.researchResult.analystCustomerRequests).toBe(analystCustomerRequests);

  const listeners = {};
  const customerWindow = { postMessage: jest.fn() };
  const windowRef = {
    location: { protocol: "http:", hostname: "localhost", origin: "http://localhost:3000" },
    open: jest.fn(() => customerWindow),
    addEventListener: jest.fn((name, listener) => { listeners[name] = listener; }),
    removeEventListener: jest.fn(),
    setTimeout: jest.fn(() => 7),
    clearTimeout: jest.fn(),
  };
  const accepted = openCustomerViewHandoff(payload, { windowRef });
  const openedUrl = windowRef.open.mock.calls[0][0];
  expect(openedUrl).toContain("handoff=ubo-demo-customer-handoff-v1");
  expect(openedUrl).not.toContain("fact-1");
  listeners.message({ origin: "http://malicious.example", source: customerWindow, data: { type: CUSTOMER_HANDOFF_READY } });
  expect(customerWindow.postMessage).not.toHaveBeenCalled();
  listeners.message({ origin: "http://localhost:3000", source: customerWindow, data: { type: CUSTOMER_HANDOFF_READY } });
  expect(customerWindow.postMessage).toHaveBeenCalledWith({ type: CUSTOMER_HANDOFF_DELIVERY, payload }, "http://localhost:3000");
  listeners.message({ origin: "http://localhost:3000", source: customerWindow, data: { type: CUSTOMER_HANDOFF_ACCEPTED, contractVersion: CUSTOMER_HANDOFF_CONTRACT } });
  await expect(accepted).resolves.toContain("http://localhost:3000/ubo-demo/customer/");
});

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
