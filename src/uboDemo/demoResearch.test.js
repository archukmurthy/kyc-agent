/**
 * A platform error page (a gateway timeout, say) is HTML, not JSON. The
 * research call must refuse with its plain message, not a parser error
 * ("Unexpected token <") shown to the analyst (review, 2026-10-09).
 */
import { runDemoResearch } from "./demoResearch";

jest.mock("../auth/clerkFetch", () => ({ clerkAuthHeaders: async () => ({}) }));

test("an error page that is not JSON becomes a plain refusal", async () => {
  const fetchImpl = jest.fn(async () => ({
    ok: false,
    status: 504,
    headers: { get: () => "text/html" },
    json: async () => { throw new SyntaxError("Unexpected token <"); },
  }));
  const demoCase = { demoCaseId: "case-1", company: { legalName: "Example Limited", registrationNumber: "00000001", countryCode: "GB", ownershipType: "LIMITED_COMPANY" } };
  const run = runDemoResearch({ demoCase, sourceMode: "LIVE" }, fetchImpl, { timeoutMs: 5000 });
  await expect(run).rejects.toMatchObject({ message: "Research could not be completed safely.", status: 504 });
});
