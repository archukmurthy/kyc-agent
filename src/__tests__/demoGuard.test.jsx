/**
 * demoGuard.test.jsx - safety net for the two paid-research guards added to
 * App.js: (1) doResearch (the REAL, paid Anthropic + web-search path) refuses
 * to run without a window.confirm() accept when the demo toggle is visible
 * (dev/testing contexts) and demo mode is off; (2) setDemoMode persists an
 * EXPLICIT value to sessionStorage so an opt-out survives.
 *
 * Drives the real app the same way JourneyPicker.render.test.jsx does: fill
 * Company Lookup, open the journey picker, pick card B ("Let AI research your
 * company" - journeyType "ai_only", no document phase, so doResearch reaches
 * fetch("/api/research") directly with nothing else in the way), Continue.
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../App";

jest.setTimeout(60000);

beforeEach(() => {
  // /api/config, track-event and ipify fire on mount. Rejecting them makes the
  // app fall back to buildLocalDefaultConfig() deterministically, same as the
  // other render nets.
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  try { sessionStorage.clear(); } catch (_) { /* ignore */ }
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  try { sessionStorage.clear(); } catch (_) { /* ignore */ }
});

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

const continueBtn = () => screen.getByRole("button", { name: /^Continue/ });
const CARD_B = "Let AI research your company";
const card = (title) => screen.getByText(title).parentElement;

const researchCalls = () =>
  global.fetch.mock.calls.filter(([url]) => url === "/api/research");

/** Company Lookup → Continue → journey picker → card B → Continue. */
async function driveToResearchKickoff() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);

  fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), {
    target: { value: "Britannia Group Limited" },
  });
  fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), {
    target: { value: "Corporate" },
  });
  pickOption("🏛 Corporate");
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");
  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB - United Kingdom");
  fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
  await settle(0);

  fireEvent.click(card(CARD_B));
  await settle(0);
  fireEvent.click(continueBtn());
  await settle(5000);
}

describe("doResearch paid-call confirm guard", () => {
  // demoMode starts false under Jest (NODE_ENV === "test" gates the new
  // localhost default off), and demoToggleVisible is true (jsdom host is
  // "localhost") - exactly the conditions the guard fires under.

  it("aborts and never calls /api/research when the user declines the confirm", async () => {
    window.confirm.mockReturnValueOnce(false);
    await driveToResearchKickoff();

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/REAL research call.*COST money/)
    );
    expect(researchCalls()).toHaveLength(0);
  });

  it("proceeds to /api/research when the user accepts the confirm", async () => {
    window.confirm.mockReturnValueOnce(true);
    await driveToResearchKickoff();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(researchCalls()).toHaveLength(1);
  });
});

describe("research request shape (server-built prompts)", () => {
  it("sends structured research input, then gap recovery by field id, never a prompt", async () => {
    window.confirm.mockReturnValueOnce(true);
    global.fetch = jest.fn((url) => (url === "/api/research"
      ? Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "{\"found\":[]}" }], usage: { input_tokens: 1, output_tokens: 1 } }),
      })
      : Promise.reject(new Error("offline test"))));
    await driveToResearchKickoff();
    await settle(5000);

    const bodies = researchCalls().map(([, init]) => JSON.parse(init.body));
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(bodies[0]).toMatchObject({
      mode: "research",
      companyName: "Britannia Group Limited",
      countryCode: "GB",
      entityType: "Corporate",
    });
    expect(typeof bodies[0].ownershipType).toBe("string");
    expect(bodies[1].mode).toBe("gap_recovery");
    expect(Array.isArray(bodies[1].missingFields)).toBe(true);
    expect(bodies[1].missingFields.length).toBeGreaterThan(0);
    bodies[1].missingFields.forEach((id) => expect(typeof id).toBe("string"));
    for (const body of bodies) {
      for (const key of ["prompt", "messages", "model", "tools", "max_tokens"]) {
        expect(body).not.toHaveProperty(key);
      }
    }
  });

  it("shows the rate-limit message when research returns 429", async () => {
    window.confirm.mockReturnValueOnce(true);
    global.fetch = jest.fn((url) => (url === "/api/research"
      ? Promise.resolve({ ok: false, status: 429, json: async () => ({ error: "rate_limited", retryAfterSeconds: 120 }) })
      : Promise.reject(new Error("offline test"))));
    await driveToResearchKickoff();
    await settle(0);

    expect(screen.getAllByText(/Too many requests - please try again in 2 minutes/).length).toBeGreaterThan(0);
  });
});

describe("setDemoMode persistence", () => {
  it("writes an explicit sessionStorage opt-out so it survives the localhost default", async () => {
    await act(async () => {
      render(<KYCAgent />);
    });
    await settle(0);

    // The DemoToggle only mounts on the journey picker - reach it the same
    // way driveToResearchKickoff does, minus the card click.
    fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), {
      target: { value: "Britannia Group Limited" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), {
      target: { value: "Corporate" },
    });
    pickOption("🏛 Corporate");
    fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
    pickOption("Private Limited Company");
    fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
      target: { value: "United King" },
    });
    pickOption("GB - United Kingdom");
    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    await settle(0);

    // Flip it on then off - the off flip is the explicit opt-out under test.
    const toggle = screen
      .getByTitle(/Skip API calls/i)
      .querySelector('input[type="checkbox"]');
    fireEvent.click(toggle); // on
    await settle(0);
    fireEvent.click(toggle); // explicit off
    await settle(0);

    expect(sessionStorage.getItem("demo_mode")).toBe("false");
  });
});
