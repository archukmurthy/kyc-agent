import { isDemoToggleVisible } from "../demoToggle";

test("a real customer URL with ?tenant= on a non-localhost host hides the toggle", () => {
  expect(isDemoToggleVisible({ search: "?tenant=acme", hostname: "kyc.example.com" })).toBe(false);
});

test("?demo=true shows the toggle", () => {
  expect(isDemoToggleVisible({ search: "?tenant=acme&demo=true", hostname: "kyc.example.com" })).toBe(true);
});

test("localhost shows the toggle", () => {
  expect(isDemoToggleVisible({ search: "?tenant=acme", hostname: "localhost" })).toBe(true);
  expect(isDemoToggleVisible({ search: "", hostname: "127.0.0.1" })).toBe(true);
});
