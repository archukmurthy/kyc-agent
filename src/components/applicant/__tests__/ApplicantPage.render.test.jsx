/**
 * ApplicantPage.render.test.jsx — CHARACTERISATION of the Applicant page while
 * it is still inline in App.js (renderApplicantPage and its helpers).
 *
 * WHY NOW: the Applicant page has no test coverage at all — the 33 existing
 * render tests cover Confirm only. It is next in line to be extracted, and both
 * Confirm slices were only safe because a red test meant a broken move. This
 * builds the same oracle first.
 *
 * The page cannot be rendered in isolation: renderApplicantPage closes over
 * App's state, refs (gapRef) and the fact-dispute machine, and its call site is
 * guarded by `step === STEPS.applicant && agentType !== "preboarding"`. So this
 * drives the REAL app through the wizard to that step — the same harness
 * ConfirmPeople.render.test.jsx uses, deliberately mirrored rather than
 * reinvented.
 *
 * CHARACTERISATION, not specification: these assert what the page does TODAY.
 * A surprising assertion here is a recorded fact. After the extraction this
 * file must stay green UNCHANGED — editing it to make the extraction pass would
 * defeat the point.
 */

import React from "react";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";

jest.setTimeout(60000);

beforeEach(() => {
  // /api/config, track-event and ipify fire on mount. Rejecting them makes the
  // app fall back to buildLocalDefaultConfig(), which ships the Corporate:GB
  // schema — deterministic, no network.
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Pick an option out of a SearchableSelect (it commits on mousedown). */
function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

/**
 * Company lookup → dummy research → STOP on the Applicant step.
 * This is ConfirmPeople's driver truncated: Applicant is the step it passes
 * through on the way to Confirm.
 */
async function driveToApplicant() {
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

  // SearchableSelect opens on FOCUS, not click — fireEvent.click does not focus
  // in jsdom.
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");

  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB — United Kingdom");

  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);
}

const pdf = (name = "doc.pdf") => new File(["%PDF"], name, { type: "application/pdf" });

/** The page renders two file inputs — signatory ID first, authority-to-act second. */
const fileInputs = () => Array.from(document.querySelectorAll('input[type="file"]'));

/**
 * The person selector, addressed by its own placeholder option.
 * There are several <select>s on this page (gap fields render as selects too),
 * so "the combobox" is ambiguous — this names the one we mean.
 */
const personSelect = () =>
  screen.getByRole("option", { name: /Select your name/i }).closest("select");

/**
 * A gap field, addressed by PLACEHOLDER.
 * StableInput sets no DOM id and its <label> is not associated with the input,
 * so getElementById and getByLabelText both miss. The placeholder is derived
 * from the label ("Enter " + label.toLowerCase()), which is observable output
 * and survives the field moving to another file.
 */
const gapField = (labelText) =>
  screen.getByPlaceholderText(new RegExp(`^Enter ${labelText}$`, "i"));

describe("reaching the Applicant step", () => {
  it("renders the Applicant page after research completes", async () => {
    await driveToApplicant();
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  });

  it("renders the FoundationalFactsGate above the applicant section", async () => {
    await driveToApplicant();
    expect(screen.getByTestId("foundational-facts-gate")).toBeInTheDocument();
    expect(
      screen.getByText(/Before you continue — confirm the company we researched/)
    ).toBeInTheDocument();
  });

  it("shows the five foundational facts, all confirmed by default", async () => {
    await driveToApplicant();
    const gate = screen.getByTestId("foundational-facts-gate");
    ["Company legal name", "Registration / company number", "Registration country",
     "Entity type", "Ownership type"].forEach((label) => {
      expect(within(gate).getByText(label)).toBeInTheDocument();
    });
    // Every disputable fact arrives ticked — the applicant section below is
    // revealed only while all five are confirmed.
    within(gate)
      .getAllByRole("checkbox")
      .forEach((cb) => expect(cb).toBeChecked());
  });

  it("hides the applicant section when a fact is disputed, and restores it", async () => {
    await driveToApplicant();
    const gate = screen.getByTestId("foundational-facts-gate");
    const nameFact = within(gate).getByLabelText(/Confirm Company legal name/i);

    fireEvent.click(nameFact);
    await settle(0);
    expect(screen.queryByText("Tell us about yourself")).not.toBeInTheDocument();
    expect(screen.getByText(/This restarts your application/)).toBeInTheDocument();

    fireEvent.click(nameFact);
    await settle(0);
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  });
});

describe("the person selector", () => {
  it("renders the selector with the researched candidates plus the opt-out", async () => {
    await driveToApplicant();
    expect(screen.getByText("Who is completing this application?")).toBeInTheDocument();
    const select = personSelect();
    expect(within(select).getByText("Select your name...")).toBeInTheDocument();
    expect(within(select).getByText(/I am not listed — fill in manually/)).toBeInTheDocument();
    // Dummy research supplies directors, so there is at least one real
    // candidate between the placeholder and the opt-out.
    expect(within(select).getAllByRole("option").length).toBeGreaterThan(2);
  });

  it("explains that picking a name pre-fills the fields", async () => {
    await driveToApplicant();
    expect(
      screen.getByText(/Picking your name pre-fills the fields below from the official registry/)
    ).toBeInTheDocument();
  });

  it("pre-fills the applicant name when a candidate is selected", async () => {
    await driveToApplicant();
    const select = personSelect();
    const candidate = within(select)
      .getAllByRole("option")
      .find((o) => o.value && o.value !== "none");

    fireEvent.change(select, { target: { value: candidate.value } });
    await settle(0);

    expect(select.value).toBe(candidate.value);
    // The chosen person's name lands in the first/last name inputs.
    expect(String(gapField("applicant first name").value).trim().length).toBeGreaterThan(0);
  });

  it('"I am not listed" clears the selection and asks for authority to act', async () => {
    await driveToApplicant();
    const select = personSelect();

    fireEvent.change(select, { target: { value: "none" } });
    await settle(0);

    expect(select.value).toBe("none");
    // The unlisted path adds the authority-to-act requirement, so a SECOND
    // upload card appears alongside the always-present signatory ID one.
    expect(fileInputs().length).toBe(2);
    expect(screen.getByText(/Upload your authority-to-act document above to continue/))
      .toBeInTheDocument();
  });
});

describe("the applicant gap fields", () => {
  it("renders the required identity fields as inputs", async () => {
    await driveToApplicant();
    ["applicant first name", "applicant last name", "applicant email"].forEach((label) => {
      expect(gapField(label)).toBeInTheDocument();
    });
  });

  it("keeps what is typed into a gap field", async () => {
    await driveToApplicant();
    const email = gapField("applicant email");
    fireEvent.change(email, { target: { value: "someone@example.com" } });
    await settle(0);
    expect(email.value).toBe("someone@example.com");
  });
});

describe("the upload cards", () => {
  it("always renders the signatory-ID card, for every applicant", async () => {
    await driveToApplicant();
    expect(screen.getByText("Signatory ID")).toBeInTheDocument();
    expect(fileInputs().length).toBeGreaterThanOrEqual(1);
  });

  it("renders authority-to-act ONLY once the applicant says they are unlisted", async () => {
    await driveToApplicant();
    expect(fileInputs().length).toBe(1);

    fireEvent.change(personSelect(), { target: { value: "none" } });
    await settle(0);
    expect(fileInputs().length).toBe(2);
  });

  it("accepts a signatory-ID upload and clears that gate message", async () => {
    await driveToApplicant();
    expect(screen.getByText(/Upload the signatory ID document above to continue/))
      .toBeInTheDocument();

    fireEvent.change(fileInputs()[0], { target: { files: [pdf("id.pdf")] } });
    await settle(0);

    expect(screen.queryByText(/Upload the signatory ID document above to continue/))
      .not.toBeInTheDocument();
  });
});

describe("the Continue gate", () => {
  it("blocks while the signatory ID is missing", async () => {
    await driveToApplicant();
    const cont = screen.getByRole("button", { name: /Continue/ });
    expect(cont).toBeDisabled();
    expect(screen.getByText(/Upload the signatory ID document above to continue/))
      .toBeInTheDocument();
  });

  it("stays blocked for an unlisted applicant until authority-to-act is uploaded", async () => {
    await driveToApplicant();
    fireEvent.change(personSelect(), { target: { value: "none" } });
    await settle(0);

    fireEvent.change(fileInputs()[0], { target: { files: [pdf("id.pdf")] } });
    await settle(0);

    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
    expect(screen.getByText(/Upload your authority-to-act document above to continue/))
      .toBeInTheDocument();
  });

  it("enables Continue once the ID is uploaded and required fields are filled", async () => {
    await driveToApplicant();
    const select = personSelect();
    const candidate = within(select)
      .getAllByRole("option")
      .find((o) => o.value && o.value !== "none");
    fireEvent.change(select, { target: { value: candidate.value } });
    await settle(0);

    fireEvent.change(fileInputs()[0], { target: { files: [pdf("id.pdf")] } });
    await settle(0);

    expect(screen.getByRole("button", { name: /Continue/ })).toBeEnabled();
  });

  it("advances to Confirm when the gate is satisfied", async () => {
    await driveToApplicant();
    fireEvent.click(screen.getByRole("button", { name: /Fill with test data/i }));
    const input = fileInputs()[0];
    fireEvent.change(input, { target: { files: [pdf("id.pdf")] } });
    await settle(0);

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await settle(0);

    expect(screen.queryByText("Tell us about yourself")).not.toBeInTheDocument();
    expect(screen.getByText("People Found")).toBeInTheDocument();
  });
});

describe("the test-data control", () => {
  // SHOW_TEST_TOOLS is `NODE_ENV !== "production"`, which is true under Jest,
  // so the control renders here. It is gated out of production builds.
  it("renders and fills the applicant fields", async () => {
    await driveToApplicant();
    const btn = screen.getByRole("button", { name: /Fill with test data/i });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    await settle(0);

    ["applicant first name", "applicant last name", "applicant email"].forEach((label) => {
      expect(String(gapField(label).value).trim().length).toBeGreaterThan(0);
    });
  });
});

describe("page navigation", () => {
  it("offers Start Over alongside Continue", async () => {
    await driveToApplicant();
    expect(screen.getByRole("button", { name: /Start Over/i })).toBeInTheDocument();
  });
});
