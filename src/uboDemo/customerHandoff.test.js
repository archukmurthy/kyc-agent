import {
  buildCustomerHandoff,
  CUSTOMER_HANDOFF_ACCEPTED,
  CUSTOMER_HANDOFF_CONTRACT,
  CUSTOMER_HANDOFF_DELIVERY,
  CUSTOMER_HANDOFF_READY,
  openCustomerViewHandoff,
  resolveCustomerDemoUrl,
} from "./customerHandoff";

test("local customer URL follows the active hostname and a configured deployment URL takes precedence", () => {
  expect(resolveCustomerDemoUrl({ protocol: "http:", hostname: "localhost", origin: "http://localhost:3000" }, "").href).toBe("http://localhost:3002/ubo-demo/");
  expect(resolveCustomerDemoUrl({ protocol: "https:", hostname: "preview.example", origin: "https://preview.example" }, "https://customer.example/ubo-demo/").href).toBe("https://customer.example/ubo-demo/");
  expect(resolveCustomerDemoUrl({ protocol: "https:", hostname: "preview.example", origin: "https://preview.example" }, "")).toBeNull();
});

test("handoff keeps every normalized source assertion out of the URL and delivers it only after an exact-origin ready signal", async () => {
  const candidateSources = [{ sourceRecordId: "source-1", candidateFacts: [{ factId: "fact-1" }, { factId: "fact-2" }] }];
  const payload = buildCustomerHandoff({
    draft: { legalName: "Target Ltd" },
    demoCase: { demoCaseId: "demo-1", company: { legalName: "Target Ltd" } },
    researchResult: { candidateSources },
  }, () => "2026-09-16T12:00:00.000Z");
  expect(payload.researchResult.candidateSources).toBe(candidateSources);

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
  const accepted = openCustomerViewHandoff(payload, { windowRef, configuredUrl: "http://localhost:3002/ubo-demo/" });
  const openedUrl = windowRef.open.mock.calls[0][0];
  expect(openedUrl).toContain("handoff=ubo-demo-customer-handoff-v1");
  expect(openedUrl).not.toContain("fact-1");
  listeners.message({ origin: "http://malicious.example", source: customerWindow, data: { type: CUSTOMER_HANDOFF_READY } });
  expect(customerWindow.postMessage).not.toHaveBeenCalled();
  listeners.message({ origin: "http://localhost:3002", source: customerWindow, data: { type: CUSTOMER_HANDOFF_READY } });
  expect(customerWindow.postMessage).toHaveBeenCalledWith({ type: CUSTOMER_HANDOFF_DELIVERY, payload }, "http://localhost:3002");
  listeners.message({ origin: "http://localhost:3002", source: customerWindow, data: { type: CUSTOMER_HANDOFF_ACCEPTED, contractVersion: CUSTOMER_HANDOFF_CONTRACT } });
  await expect(accepted).resolves.toContain("http://localhost:3002/ubo-demo/");
});
