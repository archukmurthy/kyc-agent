/**
 * The headers every UBO request carries. A customer holding a session for one
 * case sends it with every call; nobody else ever does.
 */
import { clerkAuthHeaders } from "./clerkFetch";
import { clearCustomerSession, setCustomerSession } from "./customerSession";

afterEach(() => {
  clearCustomerSession();
  delete window.Clerk;
});

test("with nobody signed in and no customer session, no headers", async () => {
  expect(await clerkAuthHeaders()).toEqual({});
});

test("a signed-in person sends their Clerk token", async () => {
  window.Clerk = { session: { getToken: async () => "clerk-token" } };
  expect(await clerkAuthHeaders()).toEqual({ Authorization: "Bearer clerk-token" });
});

test("a customer sends their case session as well", async () => {
  window.Clerk = { session: { getToken: async () => "clerk-token" } };
  setCustomerSession({ session: "customer-session", caseId: "case-1" });
  expect(await clerkAuthHeaders()).toEqual({ Authorization: "Bearer clerk-token", "x-ubo-customer-session": "customer-session" });
});

test("a customer session is sent even while sign-in is switched off (local development)", async () => {
  setCustomerSession({ session: "customer-session", caseId: "case-1" });
  expect(await clerkAuthHeaders()).toEqual({ "x-ubo-customer-session": "customer-session" });
});
