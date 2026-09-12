/**
 * demoGuard.test.jsx — safety net for the two paid-research guards added to
 * App.js: (1) doResearch (the REAL, paid Anthropic + web-search path) refuses
 * to run without a window.confirm() accept when the demo toggle is visible
 * (dev/testing contexts) and demo mode is off; (2) setDemoMode persists an
 * EXPLICIT value to sessionStorage so an opt-out survives.
 *
 * Drives the real app the same way JourneyPicker.render.test.jsx does: fill
 * Company Lookup, open the journey picker, pick card B ("Let AI research your
 * company" — journeyType "ai_only", no document phase, so doResearch reaches
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
  // "localhost") — exactly the conditions the guard fires under.

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

describe("setDemoMode persistence", () => {
  it("writes an explicit sessionStorage opt-out so it survives the localhost default", async () => {
    await act(async () => {
      render(<KYCAgent />);
    });
    await settle(0);

    // The DemoToggle only mounts on the journey picker — reach it the same
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

    // Flip it on then off — the off flip is the explicit opt-out under test.
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
