import { rateLimitMessage } from "../rateLimitMessage";

test("rounds up to whole minutes", () => {
  expect(rateLimitMessage(120)).toBe("Too many requests — please try again in 2 minutes");
  expect(rateLimitMessage(121)).toBe("Too many requests — please try again in 3 minutes");
});

test("never says zero and uses the singular for one minute", () => {
  expect(rateLimitMessage(5)).toBe("Too many requests — please try again in 1 minute");
  expect(rateLimitMessage(undefined)).toBe("Too many requests — please try again in 1 minute");
  expect(rateLimitMessage("nonsense")).toBe("Too many requests — please try again in 1 minute");
});
