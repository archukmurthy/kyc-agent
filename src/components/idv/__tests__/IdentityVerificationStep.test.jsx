import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import IdentityVerificationStep from "../IdentityVerificationStep";

test("renders a Start button and calls /api/idv-start on click", async () => {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ hostedUrl: "https://verification.didit.me/s/x", providerSessionId: "s1" }) };
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <IdentityVerificationStep submissionId="ref-1" onVerified={() => {}} onContinue={() => {}} cardStyle={{}} Btn={(p) => <button {...p} />} />
    );
  });
  const startBtn = [...container.querySelectorAll("button")].find((b) => /start/i.test(b.textContent));
  expect(startBtn).toBeTruthy();
  await act(async () => { startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(calls.some((u) => String(u).includes("/api/idv-start"))).toBe(true);
  await act(async () => { root.unmount(); });
});
