/**
 * HoverTooltip.jsx — a lightweight, purely presentational hover tooltip used on
 * the Confirm page to keep supporting copy out of the default view.
 *
 * Why its own component rather than state on ConfirmStep: the hover state stays
 * local, so moving the mouse over a trigger does NOT re-render ConfirmStep (and
 * with it the whole found-fields table and its inline editors).
 *
 * Layout contract: the popover is absolutely positioned and therefore OUT OF
 * FLOW — showing or hiding it must never reflow the page. The wrapper is an
 * inline-block `span` (valid phrasing content, so it can live inside an <h2>),
 * and everything inside the popover is a `span` too — never a <div> — so the
 * markup stays legal wherever the trigger is placed.
 *
 * Desktop hover is the required interaction; focus/blur is wired up as a free
 * keyboard bonus, not a supported mobile affordance.
 */

import { useState } from "react";
import { C } from "../../constants/theme";

const POPOVER = (width, align) => ({
  position: "absolute",
  top: "calc(100% + 9px)",
  left: align === "center" ? "50%" : 0,
  transform: align === "center" ? "translateX(-50%)" : "none",
  width,
  maxWidth: "min(360px, 88vw)",
  zIndex: 80,
  boxSizing: "border-box",
  background: "#fff",
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  boxShadow: "0 8px 24px rgba(26,58,74,0.16)",
  padding: "11px 13px",
  // Reset every inherited text style — triggers include a bold <h2> and an
  // uppercase, letter-spaced, centred tile label.
  fontSize: 12.5,
  fontWeight: 400,
  lineHeight: 1.5,
  color: C.textMuted,
  textAlign: "left",
  textTransform: "none",
  letterSpacing: "normal",
  whiteSpace: "normal",
  // The tooltip is decoration: it must not eat pointer events or create a
  // hover target of its own that keeps itself open.
  pointerEvents: "none",
});

const ARROW = (align) => ({
  position: "absolute",
  top: -5,
  left: align === "center" ? "calc(50% - 4.5px)" : 18,
  width: 9,
  height: 9,
  background: "#fff",
  borderLeft: `1px solid ${C.border}`,
  borderTop: `1px solid ${C.border}`,
  transform: "rotate(45deg)",
});

export function HoverTooltip({
  content,
  children,
  width = 320,
  align = "left",
  wrapStyle,
  testId,
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block", ...wrapStyle }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span role="tooltip" data-testid={testId} style={POPOVER(width, align)}>
          <span aria-hidden="true" style={ARROW(align)} />
          {content}
        </span>
      )}
    </span>
  );
}

export default HoverTooltip;
