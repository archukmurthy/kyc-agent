/**
 * StakeholderGapForms.render.test.jsx — CHARACTERISATION of the Fill Gaps
 * stakeholder-forms cluster while it is still inline in App.js.
 *
 * WHY NOW: the Fill Gaps page has NO test coverage at all. Slice 1 of its
 * extraction lifts ~931 lines out of App.js (3666–4622, 4704–4718, 1175–1189)
 * into StakeholderGapForms.jsx. Both Confirm slices were only safe because a red
 * test meant a broken move. This builds the same oracle first.
 *
 * WHY IT ASSERTS FIELD CONTENT, NOT JUST PRESENCE. The shell does not CALL the
 * cluster — it renders four values precomputed in App's body (App.js:4708–4718):
 *
 *   stakeholderGapRows → stakeholderFormNodes / stakeholderSummaryNodes
 *                      → hasStakeholderForms / hasStakeholderSummary
 *
 * and drops {stakeholderFormNodes} / {stakeholderSummaryNodes} at 8040/8055,
 * each behind a divider gated by the matching boolean. If the extraction breaks
 * how those arrays are built or handed over, the page still renders and the
 * dividers may still show — with nothing beneath them. A test that only checked
 * "Fill Gaps renders" would stay green through exactly that break. So every
 * assertion here reaches INTO the cards and names real rendered output.
 *
 * The page cannot be rendered in isolation (the cluster closes over App's state,
 * stakeholdersRef and the schema), so this drives the REAL app through the
 * wizard — the ConfirmPeople harness, deliberately mirrored rather than
 * reinvented, extended ONE STEP further: Input → Applicant → Confirm → Fill Gaps.
 *
 * CHARACTERISATION, not specification: these assert what the cluster does TODAY.
 * A surprising assertion is a recorded fact. After the extraction this file must
 * stay green UNCHANGED — editing it to make the move pass defeats the point.
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

const buttonsWithText = (text) =>
  Array.from(document.querySelectorAll("button")).filter(
    (b) => (b.textContent || "").trim() === text
  );

/**
 * Confirm's footer gate blocks on every row/person still needing input ("19
 * items need your input" on the dummy set). Clear it the way a customer does:
 * the per-person "Confirm all" controls, then every remaining row tick. Looped
 * because confirming a person re-renders and reveals the next batch.
 */
async function satisfyConfirmGate() {
  for (let pass = 0; pass < 4; pass += 1) {
    buttonsWithText("✓ Confirm all").forEach((b) => fireEvent.click(b));
    await settle(0);
    buttonsWithText("✓").forEach((b) => fireEvent.click(b));
    await settle(0);
    const cont = Array.from(document.querySelectorAll("button")).find((b) =>
      /Confirm and Continue/.test(b.textContent || "")
    );
    if (cont) return cont;
  }
  throw new Error("Confirm gate never opened — the driver, not the cluster, is broken");
}

/** Company → dummy research → Applicant → Confirm (stops there). */
async function driveToConfirm() {
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
  // in jsdom. Private Limited keeps effectivelyListed false, which is the branch
  // the whole forms section depends on.
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");

  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), {
    target: { value: "United King" },
  });
  pickOption("GB — United Kingdom");

  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);

  // Applicant page — fill via the test-data control, satisfy the signatory
  // upload, continue.
  fireEvent.click(screen.getByRole("button", { name: /Fill with test data/i }));
  const fileInput = document.querySelector('input[type="file"]');
  if (fileInput) {
    fireEvent.change(fileInput, {
      target: { files: [new File(["%PDF"], "id.pdf", { type: "application/pdf" })] },
    });
  }
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /^Continue/i }));
  await settle(0);
}

/** …and on through the Confirm gate to Fill Gaps. */
async function driveToFillGaps() {
  await driveToConfirm();
  fireEvent.click(await satisfyConfirmGate());
  await settle(0);
}

const DUMMY_PEOPLE = ["John Smith", "Jane Doe", "Trustees", "Mark Lee"];

/**
 * A per-attribute control on a Confirm person card, disambiguated by WHOSE card
 * it is and WHICH group the card is in.
 *
 * The dummy set puts John Smith and Jane Doe in BOTH the UBO group and the
 * directors group, as separate stakeholder records with different sh_ ids, so
 * the name alone is ambiguous. The director cards are the ones carrying a
 * "Role / position" row — UBO cards have "Shareholding" instead — which is what
 * `director` selects on. Both are observable output, so this survives the lift.
 */
function personAttrControl(personName, ariaLabel, { director }) {
  return Array.from(document.querySelectorAll("button"))
    .filter((b) => b.getAttribute("aria-label") === ariaLabel)
    .find((b) => {
      let node = b;
      while (node) {
        const text = node.textContent || "";
        const names = DUMMY_PEOPLE.filter((n) => text.includes(n));
        if (names.length === 1) {
          return names[0] === personName && /Role \/ position/.test(text) === director;
        }
        node = node.parentElement;
      }
      return false;
    });
}

/**
 * The LISTED journey — the only way to reach three of the cluster's render
 * functions, all gated on `effectivelyListed` (App.js:453), which a private
 * company leaves false.
 *
 * It sets the flag through the real Confirm control rather than mocking state,
 * then puts three DIRECTORS into three different states. Directors are the
 * useful group here because `needsStakeholderDetails` returns false for a
 * listed company's non-UBO people (pipeline.js:1390) — every UBO in the dummy
 * set holds >= 25%, so they still take the full-EDD path either way.
 *
 *   Mark Lee   — unticked  → customer_rejected → light replacement card
 *   Jane Doe   — one attribute corrected inline → the corrected value carries
 *                through to Fill Gaps
 *   John Smith — left alone → confirmedOnly → the read-only listed summary
 *
 * WHAT THIS JOURNEY DOES *NOT* REACH — renderFieldCorrectionCard (4356) and
 * renderCorrectionField (4297). They render for a listed person who is KEPT but
 * has `stkHasCorrections`, i.e. an attribute that is found and NOT ticked
 * (App.js:3557). That state cannot exist at Fill Gaps any more:
 *
 *   - while an attribute is unticked it is not settled — isPersonAttributeSettled
 *     needs `corrected || ticked` (App.js:1074) — so the Confirm footer blocks
 *     ("1 item needs your input") and the journey can never leave the page; and
 *   - resolving it re-ticks the field on save, which resolvePersonCorrection does
 *     deliberately and says so in its own comment ("RE-TICK. Unticking is what
 *     opened this editor, and 'unticked' is also what routes an attribute to Fill
 *     Gaps for correction… asked them for the same value twice, on two pages").
 *
 * So the inline editor closed the very route those two cards exist to serve, and
 * they are dead on every UI path. Recorded here rather than forced: reaching them
 * would need seeded state (a dossier loaded mid-correction), not a journey.
 */
async function driveToListedFillGaps() {
  await driveToConfirm();

  // The SHOW_TEST_TOOLS override — same state, same downstream effectivelyListed
  // as real auto-detection.
  fireEvent.click(screen.getByRole("checkbox", { name: /treat as publicly listed/i }));
  await settle(0);

  // Open the gate first, while the cards are still collapsed: the per-person
  // "Confirm all" controls settle every attribute in one click each.
  const cont = await satisfyConfirmGate();

  // Attribute rows only exist on an EXPANDED card.
  buttonsWithText("Expand all ▾").forEach((b) => fireEvent.click(b));
  await settle(0);

  // Mark Lee is directors-only, so his name is unambiguous. Unticking opens the
  // removal prompt; answering it is what records the rejection.
  fireEvent.click(screen.getByRole("checkbox", { name: /Mark Lee/ }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /No longer a director/i }));
  await settle(0);

  // Jane Doe the DIRECTOR — the ✎ control calls togglePersonField when the field
  // is ticked (StakeholderConfirmSection.jsx:178), which is what clears
  // isStkFieldConfirmed and creates the correction. The inline editor then opens;
  // saving a value settles the row so the footer gate can reopen.
  //
  // ROLE, deliberately: PERSON-ROLE-CHANGE is `accept_silent` with no document
  // (policyTable.js:284). Correcting nationality or DOB fires PERSON-NATIONALITY-*
  // / PERSON-DOB-*, which request a Proof of Identity and leave the footer
  // blocked on "1 document needed" — real behaviour, but it would strand this
  // driver before Fill Gaps.
  const edit = personAttrControl("Jane Doe", "Edit Role / position", { director: true });
  expect(edit).toBeTruthy();
  fireEvent.click(edit);
  await settle(0);

  fireEvent.change(screen.getByPlaceholderText("Enter the correct value"), {
    target: { value: "Company Secretary" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  await settle(0);

  // Removing a director owes a List of Directors (PERSON-REMOVAL-DIRECTOR,
  // policyTable.js:331) and the footer blocks on "1 document needed" until it is
  // uploaded — so satisfy it the way a customer does. uploadAmendmentDoc treats
  // a rejected fetch as uploadFailed, which correctly does NOT satisfy the gate,
  // so this one route has to resolve; everything else stays offline.
  global.fetch = jest.fn((url) =>
    String(url).includes("/api/upload-document")
      ? Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              blobUrl: "blob://test/list-of-directors.pdf",
              pathname: "test/list-of-directors.pdf",
              filename: "directors.pdf",
            }),
        })
      : Promise.reject(new Error("offline test"))
  );
  await act(async () => {
    fireEvent.change(document.querySelectorAll('input[type="file"]')[0], {
      target: { files: [new File(["%PDF"], "directors.pdf", { type: "application/pdf" })] },
    });
  });
  await settle(0);

  expect(cont).toBeEnabled();
  fireEvent.click(cont);
  await settle(0);
}

/**
 * The card element for a named person: climb from the name node until the
 * ancestor also holds the PEP block, which is the person-card body. Addressed
 * this way because the cards carry no test id and only inline styles.
 */
function cardFor(name) {
  const leaf = screen
    .getAllByText(name, { exact: true })
    .find((el) => el.children.length === 0);
  expect(leaf).toBeTruthy();
  let node = leaf;
  while (node && !/Politically Exposed Person/.test(node.textContent || "")) {
    node = node.parentElement;
  }
  expect(node).toBeTruthy();
  return node;
}

/**
 * The smallest container that holds `anchor` AND matches `alsoContains` — the
 * generic form of cardFor, for cards that carry no PEP block (the light
 * replacement card and the listed summary).
 */
function cardHolding(anchor, alsoContains) {
  const leaf = screen
    .getAllByText(anchor, { exact: true })
    .find((el) => el.children.length === 0);
  expect(leaf).toBeTruthy();
  let node = leaf;
  while (node && !alsoContains.test(node.textContent || "")) node = node.parentElement;
  expect(node).toBeTruthy();
  return node;
}

/** Every person/company card on the page, counted by its completion badge. */
const cardBadges = () =>
  screen.queryAllByText(/^(✅ Complete|⚠ \d+ fields? needed)$/);

describe("reaching Fill Gaps with the stakeholder forms rendered", () => {
  it("lands on the Fill Gaps page under its four-condition guard", async () => {
    await driveToFillGaps();
    expect(screen.getByText(/Additional Information Required/)).toBeInTheDocument();
    // The shell's own count line — pinned as a shape, not a number, because the
    // exact total belongs to the gap machinery, not to this cluster.
    expect(screen.getByText(/\d+ fields need your input/)).toBeInTheDocument();
  });

  it("shows the forms divider and NOT the summary divider for a private company", async () => {
    await driveToFillGaps();
    // hasStakeholderForms → true (everyone needs details when not listed).
    expect(screen.getByText("People — additional details needed")).toBeInTheDocument();
    // hasStakeholderSummary → false: renderStakeholderSummary returns null for a
    // private company because confirmedOnly is empty (App.js:4559). This is the
    // assertion that catches a divider rendering with nothing under it.
    expect(screen.queryByText("Verified information — for reference")).not.toBeInTheDocument();
  });

  it("renders a forms group per stakeholder research row, headed by the schema label", async () => {
    await driveToFillGaps();
    expect(screen.getByText(/UBO \/ Ownership Analysis/)).toBeInTheDocument();
    expect(screen.getByText(/Key Directors \(with nationality\)/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Complete the required details for each/).length
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("the person cards", () => {
  it("renders a card per researched person, with their name and shareholding", async () => {
    await driveToFillGaps();
    expect(screen.getAllByText("John Smith").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trustees").length).toBeGreaterThan(0);
    // The header line carries role/shareholding, not just the name.
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  it("renders the full identity field set inside a card", async () => {
    await driveToFillGaps();
    const card = cardFor("Trustees");
    ["Full Legal Name", "Role / Position", "Nationality", "Date of Birth", "Country of Residence"]
      .forEach((label) => {
        expect(within(card).getByText(new RegExp(label))).toBeInTheDocument();
      });
    expect(
      within(card).getByText(/A PEP holds or has held a prominent public function/)
    ).toBeInTheDocument();
  });

  it("locks an AI-found name the customer confirmed, showing it as Verified", async () => {
    await driveToFillGaps();
    const card = cardFor("Trustees");
    // nameLocked = isAIFound && isStkFieldConfirmed(id, "full_name") — true here
    // because the driver ticked everything on Confirm. The name renders as text
    // with a Verified marker, NOT as an editable input.
    expect(within(card).getAllByText("✓ Verified").length).toBeGreaterThan(0);
  });

  it("shows the per-card completion badge from stakeholderMissingFields", async () => {
    await driveToFillGaps();
    // Trustees has no nationality / DOB / PEP answer in the dummy set.
    expect(within(cardFor("Trustees")).getByText("⚠ 3 fields needed")).toBeInTheDocument();
    // Jane Doe has nationality + DOB from the registry; only PEP is outstanding.
    expect(within(cardFor("Jane Doe")).getByText("⚠ 1 field needed")).toBeInTheDocument();
  });

  it("badges the registry source on an AI-found person", async () => {
    await driveToFillGaps();
    expect(within(cardFor("Trustees")).getByText("✓ Companies House")).toBeInTheDocument();
  });

  it("renders an editable role input for a person whose role is unknown", async () => {
    await driveToFillGaps();
    // UBO role placeholder — StableInput sets no DOM id and its label is not
    // associated with the input, so placeholder is the durable query.
    expect(screen.getAllByPlaceholderText("e.g. Shareholder, UBO").length).toBeGreaterThan(0);
  });
});

describe("the mutation path — updateStakeholderField → setStakeholders → re-render", () => {
  it("answering PEP 'Yes' reveals the conditional PEP details field", async () => {
    await driveToFillGaps();
    expect(
      screen.queryByPlaceholderText(/Please describe the political position/)
    ).not.toBeInTheDocument();

    fireEvent.click(within(cardFor("Trustees")).getByRole("button", { name: "Yes" }));
    await settle(0);

    // The textarea only exists while stakeholder.is_pep === true, so its
    // appearance proves the write reached App state and came back as a render.
    expect(
      screen.getByPlaceholderText(/Please describe the political position/)
    ).toBeInTheDocument();
  });

  it("answering PEP 'No' decrements that card's missing-field count", async () => {
    await driveToFillGaps();
    expect(within(cardFor("Trustees")).getByText("⚠ 3 fields needed")).toBeInTheDocument();

    fireEvent.click(within(cardFor("Trustees")).getByRole("button", { name: "No" }));
    await settle(0);

    // 3 → 2: the round trip through the ref is observable in the badge.
    expect(within(cardFor("Trustees")).getByText("⚠ 2 fields needed")).toBeInTheDocument();
  });

  it("keeps a value typed into a stakeholder field", async () => {
    await driveToFillGaps();
    const role = screen.getAllByPlaceholderText("e.g. Shareholder, UBO")[0];
    fireEvent.change(role, { target: { value: "Shareholder" } });
    await settle(0);
    expect(role.value).toBe("Shareholder");
  });
});

describe("add and remove", () => {
  it("renders both add controls for a private company", async () => {
    await driveToFillGaps();
    expect(screen.getAllByText("+ Add individual owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+ Add company").length).toBeGreaterThan(0);
  });

  it("adds an individual and gives the new card a remove control", async () => {
    await driveToFillGaps();
    const before = cardBadges().length;
    const removesBefore = screen.queryAllByRole("button", { name: "Remove" }).length;

    fireEvent.click(screen.getAllByText("+ Add individual owner")[0]);
    await settle(0);

    expect(cardBadges().length).toBe(before + 1);
    // Only customer_added / customer_rejected people get the × control.
    expect(screen.queryAllByRole("button", { name: "Remove" }).length).toBe(removesBefore + 1);
  });

  it("removes an added person again", async () => {
    await driveToFillGaps();
    const before = cardBadges().length;

    fireEvent.click(screen.getAllByText("+ Add individual owner")[0]);
    await settle(0);
    expect(cardBadges().length).toBe(before + 1);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await settle(0);
    expect(cardBadges().length).toBe(before);
  });
});

describe("the corporate-stakeholder body", () => {
  it("renders the KYB field set instead of the person identity set", async () => {
    await driveToFillGaps();
    fireEvent.click(screen.getAllByText("+ Add company")[0]);
    await settle(0);

    expect(screen.getByText(/Business Name/)).toBeInTheDocument();
    expect(screen.getByText(/Business Type/)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("e.g. Companies House / ACRA number")
    ).toBeInTheDocument();
    expect(screen.getByText(/Registered Country/)).toBeInTheDocument();
    expect(screen.getByText(/Shareholding %/)).toBeInTheDocument();
    // A corporate card collects no person EDD.
    expect(screen.getByText("Position(s)")).toBeInTheDocument();
    expect(screen.getByText("No positions added yet.")).toBeInTheDocument();
  });

  it("counts the corporate required set, not the person one", async () => {
    await driveToFillGaps();
    fireEvent.click(screen.getAllByText("+ Add company")[0]);
    await settle(0);
    // stakeholderRequiredKeys for is_company: full_name, business_type,
    // business_registration_number, registered_country.
    expect(screen.getByText("⚠ 4 fields needed")).toBeInTheDocument();
  });

  it("adds and removes a repeatable position row", async () => {
    await driveToFillGaps();
    fireEvent.click(screen.getAllByText("+ Add company")[0]);
    await settle(0);

    fireEvent.click(screen.getByText("+ Add position"));
    await settle(0);

    // addStkPosition → updateStakeholderField → setStakeholders → re-render.
    expect(screen.queryByText("No positions added yet.")).not.toBeInTheDocument();
    const title = screen.getByPlaceholderText("e.g. Parent Company, Corporate Director");
    expect(title).toBeInTheDocument();

    fireEvent.change(title, { target: { value: "Parent Company" } });
    await settle(0);
    expect(title.value).toBe("Parent Company");

    fireEvent.click(screen.getByRole("button", { name: "Remove position" }));
    await settle(0);
    expect(screen.getByText("No positions added yet.")).toBeInTheDocument();
  });
});

describe("the page around the cluster", () => {
  it("offers Back to Review and Continue to Documents", async () => {
    await driveToFillGaps();
    expect(screen.getByRole("button", { name: /Back to Review/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue to Documents/i })).toBeInTheDocument();
  });

  it("blocks Continue and lists the stakeholder errors while cards are incomplete", async () => {
    await driveToFillGaps();
    fireEvent.click(screen.getByRole("button", { name: /Continue to Documents/i }));
    await settle(0);

    // validateStakeholders() surfaces per-person messages above the forms.
    expect(screen.getByText(/Please fix the following before continuing/)).toBeInTheDocument();
    expect(screen.getByText(/Please answer the PEP question for Trustees\./)).toBeInTheDocument();
    // Still on Fill Gaps.
    expect(screen.getByText(/Additional Information Required/)).toBeInTheDocument();
  });
});

// ─── TEMPORARY EXPLORATION — removed before commit ───
/**
 * THE LISTED JOURNEY — the listed-only branches of the same cluster.
 *
 * Everything below is unreachable on the private journey above, and all of it
 * lives inside the 3666–4622 span slice 1 lifts, so it needs an oracle too.
 */
describe("listed company — the light replacement card", () => {
  it("asks for a replacement for the director the customer removed", async () => {
    await driveToListedFillGaps();
    expect(
      screen.getByText(/You removed a director on the previous page/)
    ).toBeInTheDocument();
    expect(screen.getByText("Replacement director")).toBeInTheDocument();
    expect(screen.getByText(/Replacing: Mark Lee/)).toBeInTheDocument();
    expect(screen.getByText("⚠ Name needed")).toBeInTheDocument();
  });

  it("collects only a name and role — no EDD set", async () => {
    await driveToListedFillGaps();
    const light = cardHolding("Replacement director", /Identify-only/);
    expect(
      within(light).getByText(/a listed company's directors are public record/)
    ).toBeInTheDocument();
    expect(within(light).getByPlaceholderText("Full legal name")).toBeInTheDocument();
    expect(within(light).getByPlaceholderText("e.g. Director")).toBeInTheDocument();
    // The whole point of the light card: none of the person EDD block.
    expect(within(light).queryByText(/Politically Exposed Person/)).not.toBeInTheDocument();
    expect(within(light).queryByText(/Date of Birth/)).not.toBeInTheDocument();
  });

  it("names the replacement through the same mutation path", async () => {
    await driveToListedFillGaps();
    fireEvent.change(screen.getByPlaceholderText("Full legal name"), {
      target: { value: "Priya Raman" },
    });
    await settle(0);
    // ⚠ Name needed → ✅ Identified is driven off the stored value, so the badge
    // flipping proves the write round-tripped through App state.
    expect(screen.getByText("✅ Identified")).toBeInTheDocument();
    expect(screen.queryByText("⚠ Name needed")).not.toBeInTheDocument();
  });
});

describe("listed company — the read-only summary", () => {
  it("NOW shows the summary divider, which the private journey does not", async () => {
    await driveToListedFillGaps();
    // hasStakeholderSummary is true here: the untouched directors need no input,
    // so renderStakeholderSummary returns a node instead of null. This is the
    // exact inverse of the private-journey assertion above.
    expect(screen.getByText("Verified information — for reference")).toBeInTheDocument();
  });

  it("renders the listed summary card for the directors who need nothing", async () => {
    await driveToListedFillGaps();
    expect(
      screen.getByText(/Publicly listed company — verified from official sources/)
    ).toBeInTheDocument();
    expect(screen.getByText("🏛 Listed Company")).toBeInTheDocument();
    expect(
      screen.getByText(/directors \/ officers information is publicly disclosed through regulatory filings/)
    ).toBeInTheDocument();
  });

  it("lists the untouched directors as verified", async () => {
    await driveToListedFillGaps();
    const summary = cardHolding("🏛 Listed Company", /publicly disclosed through regulatory filings/);
    expect(within(summary).getByText("CEO")).toBeInTheDocument();
    expect(within(summary).getAllByText("✓ Verified").length).toBeGreaterThanOrEqual(2);
  });

  it("carries the corrected value through to the summary", async () => {
    await driveToListedFillGaps();
    // Jane Doe's role was corrected on Confirm from "CFO" to "Company Secretary".
    const summary = cardHolding("🏛 Listed Company", /publicly disclosed through regulatory filings/);
    expect(within(summary).getByText("Company Secretary")).toBeInTheDocument();
    expect(within(summary).queryByText("CFO")).not.toBeInTheDocument();
  });
});

describe("listed company — the EDD carve-out in the forms section", () => {
  it("still collects full details from a >= 25% beneficial owner", async () => {
    await driveToListedFillGaps();
    // needsStakeholderDetails returns true for a listed company's UBOs at or
    // above 25% (pipeline.js:1401), so the forms section keeps its full cards
    // and shows the listed-specific warning instead of the private preamble.
    expect(
      screen.getByText(/Although this is a listed company, the following beneficial owner/)
    ).toBeInTheDocument();
    expect(within(cardFor("Trustees")).getByText("⚠ 3 fields needed")).toBeInTheDocument();
    expect(
      screen.queryByText(/Complete the required details for each beneficial owner/)
    ).not.toBeInTheDocument();
  });

  it("surfaces the document the removal owes, already satisfied", async () => {
    await driveToListedFillGaps();
    expect(screen.getByTestId("amendment-documents")).toBeInTheDocument();
    expect(screen.getByText("List of Directors")).toBeInTheDocument();
    expect(screen.getByText(/directors\.pdf/)).toBeInTheDocument();
  });
});
