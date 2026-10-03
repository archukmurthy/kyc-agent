/**
 * TrialAdmin - where the owner makes a trial link without asking an engineer.
 *
 * Owner-only, and the server enforces that on every call. This screen being
 * hidden is convenience; the check in api/ubo-invite.js is the protection.
 * Anyone can post to that route directly, and creating invites is how somebody
 * would help themselves to our AI budget.
 *
 * Styled in the ownership review's own palette (src/uboDemo/uboDemo.css), so
 * the owner's screen reads as the same product as the one prospects use.
 */
import React, { useCallback, useEffect, useState } from "react";
import { createInvite, inviteLink, listInvites, markCustomer, setBudget, revokeInvite } from "./trialApi";

// The ownership review's palette (src/uboDemo/uboDemo.css).
const C = {
  ink: "#153b46",
  muted: "#617981",
  green: "#0d6958",
  greenDark: "#084f43",
  mint: "#e8f4f0",
  border: "#d7e2df",
  bg: "#f4f7f6",
  white: "#ffffff",
  amber: "#9a5b00",
  amberBg: "#fff3ce",
  red: "#9b2525",
  redBg: "#fff0f0",
};
const FONT = "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const label = { display: "block", fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 6 };
const hint = { display: "block", fontSize: 12, color: C.muted, marginTop: 4 };
const input = { padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 15, width: "100%", boxSizing: "border-box", color: C.ink, background: C.white, fontFamily: FONT };
const primary = { minHeight: 44, padding: "0 20px", border: 0, borderRadius: 8, background: C.green, color: C.white, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT };
const secondary = { minHeight: 36, padding: "0 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.ink, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT };
const cell = { padding: "16px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 14, textAlign: "left", verticalAlign: "top", color: C.ink };
const head = { ...cell, padding: "10px 14px", fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", background: C.bg };

// Hover, focus and narrow screens - what inline styles cannot express.
const SCOPED_CSS = `
.ta-page button:hover:not(:disabled) { filter: brightness(0.96); }
.ta-page button:disabled { opacity: 0.6; cursor: not-allowed; }
.ta-page button:focus-visible, .ta-page input:focus-visible, .ta-page a:focus-visible { outline: 3px solid ${C.green}; outline-offset: 2px; }
.ta-page tbody tr:hover { background: #fbfcfc; }
@media (max-width: 760px) {
  .ta-form { grid-template-columns: 1fr 1fr !important; }
  .ta-form > .ta-wide, .ta-form > button { grid-column: 1 / -1; }
  .ta-table thead { display: none; }
  .ta-table, .ta-table tbody, .ta-table tr, .ta-table td { display: block; width: 100%; box-sizing: border-box; }
  .ta-table tr { border: 1px solid ${C.border}; border-radius: 12px; margin-bottom: 12px; background: ${C.white}; }
  .ta-table td { border-bottom: 0 !important; padding: 10px 14px !important; }
}
`;

const NO_ACCESS = "Your account is not set up yet. Whoever invited you needs to add you before you can see anything here.";

/** How full a count is, as a bar: green, amber when nearly used, red when used
 *  up - unless being full is fine (every seat taken is a good sign). */
function Meter({ used, total, warn, fullIsFine = false }) {
  const share = total > 0 ? Math.min(1, used / total) : 0;
  const full = total > 0 && used >= total;
  const colour = full && !fullIsFine ? C.red : warn ? C.amber : C.green;
  return (
    <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: C.mint, marginTop: 6, overflow: "hidden", width: 120 }}>
      <div style={{ width: `${Math.round(share * 100)}%`, height: "100%", background: colour, borderRadius: 3 }} />
    </div>
  );
}

function Pill({ tone, children }) {
  const tones = {
    active: { color: C.green, background: C.mint },
    customer: { color: C.greenDark, background: "#d6efe6" },
    withdrawn: { color: C.red, background: C.redBg },
    full: { color: C.greenDark, background: "#d6efe6" },
  };
  return <span style={{ display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, marginRight: 6, ...tones[tone] }}>{children}</span>;
}

// Paid AI steps - research runs and document readings together - can be
// changed after a link has gone out: what was spent stays spent, and raising
// it lets a used-up trial carry on. The server checks the caller is the owner.
function BudgetEditor({ invite, onSaved }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(invite.budget));
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      await setBudget(invite.code, Number(value));
      setOpen(false);
      onSaved();
    } catch (caught) {
      setError(caught.message || "The budget could not be changed.");
    }
  };
  if (!open) {
    return <button type="button" style={{ ...secondary, minHeight: 30, marginTop: 8 }} onClick={() => { setValue(String(invite.budget)); setOpen(true); }}>Change</button>;
  }
  return <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
    <input aria-label={`Paid AI steps for ${invite.company}`} style={{ ...input, width: 84, padding: "6px 8px", fontSize: 14 }} type="number" min="1" max="10000" value={value} onChange={(e) => setValue(e.target.value)} />
    <button type="button" style={{ ...primary, minHeight: 34, padding: "0 12px", fontSize: 13 }} onClick={save}>Save</button>
    <button type="button" style={{ ...secondary, minHeight: 34 }} onClick={() => setOpen(false)}>Cancel</button>
    {error ? <div role="alert" style={{ color: C.red, fontSize: 12, width: "100%" }}>{error}</div> : null}
  </div>;
}

export default function TrialAdmin() {
  // null until the list has loaded: a list that failed to load is not an
  // empty one, and must never read as "No invitations yet".
  const [invites, setInvites] = useState(null);
  const [form, setForm] = useState({ company: "", seats: 5, days: 7, budget: 100 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  // Not allowed here: the refusal alone, not a form and table that cannot work.
  const [denied, setDenied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listInvites();
      setInvites(result.invites || []);
      setError("");
    } catch (err) {
      // Two different 403s: "no_access" is a person nobody has added yet,
      // "forbidden" is somebody who has access but is not an owner. Telling
      // them the wrong one wastes their afternoon.
      if (err.code === "no_access") { setError(NO_ACCESS); setDenied(true); }
      else if (err.status === 403) { setError("Only an owner can manage trial invitations."); setDenied(true); }
      else setError(err.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function submit(event) {
    event.preventDefault();
    if (!form.company.trim()) { setError("A company name is required."); return; }
    setBusy(true);
    try {
      await createInvite({
        company: form.company.trim(),
        seats: Number(form.seats),
        days: Number(form.days),
        budget: Number(form.budget),
      });
      setForm({ ...form, company: "" });
      setError("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(code) {
    const link = inviteLink(code);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      setTimeout(() => setCopied(""), 2000);
    } catch (_) {
      // Clipboard access can be refused; the link is on screen to copy by hand.
      window.prompt("Copy this link", link);
    }
  }

  const live = (invites || []).filter((invite) => !invite.revoked);
  const seatsUsed = live.reduce((sum, invite) => sum + (invite.seatsUsed || 0), 0);
  const seatsTotal = live.reduce((sum, invite) => sum + (invite.seats || 0), 0);
  const stepsUsed = live.reduce((sum, invite) => sum + (invite.budgetSpent || 0), 0);

  return (
    <div className="ta-page" style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.ink, lineHeight: 1.5 }}>
      <style>{SCOPED_CSS}</style>

      <header style={{ background: C.ink, color: C.white }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", gap: 20 }}>
          <span style={{ fontWeight: 700, letterSpacing: "0.01em" }}>Ownership review</span>
          <nav aria-label="Owner" style={{ display: "flex", gap: 4, fontSize: 14 }}>
            <span aria-current="page" style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(255,255,255,0.14)", fontWeight: 600 }}>Trials</span>
            <a href="/ubo-people" style={{ padding: "6px 10px", borderRadius: 6, color: "#cfe3de", textDecoration: "none" }}>People</a>
            <a href="/ubo-demo" style={{ padding: "6px 10px", borderRadius: 6, color: "#cfe3de", textDecoration: "none" }}>Open the demo</a>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, lineHeight: 1.2, margin: 0, fontWeight: 700, letterSpacing: "-0.01em" }}>Trial invitations</h1>
            <p style={{ color: C.muted, margin: "6px 0 0", maxWidth: 560 }}>
              One link per company. Everyone who opens it gets their own private workspace - nobody sees anyone
              else&apos;s research.
            </p>
          </div>
          {invites && invites.length > 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
              <strong style={{ color: C.ink }}>{live.length}</strong> live link{live.length === 1 ? "" : "s"}
              {" · "}<strong style={{ color: C.ink }}>{seatsUsed}</strong> of {seatsTotal} seats taken
              {" · "}<strong style={{ color: C.ink }}>{stepsUsed}</strong> paid AI steps used
            </p>
          ) : null}
        </div>

        {error ? (
          <div role="alert" style={{ background: C.redBg, border: "1px solid #f3c6c6", color: C.red, padding: "12px 14px", borderRadius: 10, marginBottom: 20, fontWeight: 500 }}>
            {error}
          </div>
        ) : null}

        {!denied && <>
        <section aria-labelledby="ta-new" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, marginBottom: 28 }}>
          <h2 id="ta-new" style={{ fontSize: 17, margin: "0 0 16px", fontWeight: 700 }}>New trial link</h2>
          <form className="ta-form" onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.3fr auto", gap: 16, alignItems: "start" }}>
            <div className="ta-wide">
              <label style={label} htmlFor="company">Company</label>
              <input id="company" style={input} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Bank" />
            </div>
            <div>
              <label style={label} htmlFor="seats">People</label>
              <input id="seats" style={input} type="number" min="1" max="50" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="days">Days</label>
              <input id="days" style={input} type="number" min="1" max="90" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="budget" title="Research runs and document readings together">Paid AI steps</label>
              <input id="budget" style={input} type="number" min="1" max="10000" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} aria-describedby="budget-hint" />
              <span id="budget-hint" style={hint}>Research runs and document readings together</span>
            </div>
            <button type="submit" style={{ ...primary, marginTop: 27 }} disabled={busy}>{busy ? "Creating…" : "Create link"}</button>
          </form>
        </section>

        <section aria-label="Invitations" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <table className="ta-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Company</th>
                <th style={head}>Link</th>
                <th style={head}>Seats</th>
                <th style={head} title="Research runs and document readings together">Paid AI steps</th>
                <th style={head}>Days</th>
                <th style={head}><span style={{ position: "absolute", left: -9999 }}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {invites === null ? (
                <tr><td style={{ ...cell, color: C.muted, padding: 28 }} colSpan={6}>{error ? "The invitations could not be loaded - see the message above." : "Loading invitations…"}</td></tr>
              ) : invites.length === 0 ? (
                <tr><td style={{ ...cell, padding: 36, textAlign: "center" }} colSpan={6}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>No invitations yet.</div>
                  <div style={{ color: C.muted, marginTop: 4 }}>Create the first trial link above, then send it to the prospect.</div>
                </td></tr>
              ) : invites.map((invite) => {
                const spent = invite.budgetSpent ?? 0;
                return (
                  <tr key={invite.code} style={{ opacity: invite.revoked ? 0.6 : 1 }}>
                    <td style={{ ...cell, minWidth: 140 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{invite.company}</div>
                      {invite.revoked ? <Pill tone="withdrawn">withdrawn</Pill>
                        : invite.seatsUsed >= invite.seats ? <Pill tone="full">all seats taken</Pill>
                          : <Pill tone="active">open</Pill>}
                      {invite.customer ? <Pill tone="customer">customer - work kept</Pill> : null}
                    </td>
                    <td style={{ ...cell, maxWidth: 280 }}>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: C.muted, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", wordBreak: "break-all" }}>
                        {inviteLink(invite.code)}
                      </div>
                      <button type="button" onClick={() => copy(invite.code)} style={{ ...secondary, minHeight: 30, marginTop: 8, color: copied === invite.code ? C.green : C.ink }}>
                        {copied === invite.code ? "Copied" : "Copy link"}
                      </button>
                    </td>
                    <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ fontWeight: 600 }}>{invite.seatsUsed} / {invite.seats}</span>
                      <Meter used={invite.seatsUsed} total={invite.seats} fullIsFine />
                    </td>
                    <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>
                      {/* Seats say how many arrived; runs say whether they actually
                          used it. A prospect at 0 of 100 after five days is a
                          conversation to have now, not after the trial ends. */}
                      <span style={{ fontWeight: 600, color: invite.nearlySpent ? C.amber : C.ink }}>
                        {spent} / {invite.budget}
                      </span>
                      <Meter used={spent} total={invite.budget} warn={invite.nearlySpent} />
                      {invite.nearlySpent ? <div style={{ fontSize: 12, fontWeight: 600, color: C.amber, marginTop: 4 }}>nearly used up</div> : null}
                      <BudgetEditor invite={invite} onSaved={refresh} />
                    </td>
                    <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>{invite.days}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
                        {/* A non-buyer's work is deleted 90 days after the trial ends.
                            This is the only thing that keeps a buyer's. */}
                        <button
                          type="button"
                          style={{ ...secondary, color: invite.customer ? C.muted : C.green }}
                          onClick={async () => {
                            await markCustomer(invite.code, !invite.customer);
                            refresh();
                          }}
                        >
                          {invite.customer ? "Undo customer" : "Mark as customer"}
                        </button>
                        {invite.revoked ? null : (
                          <button
                            type="button"
                            style={{ ...secondary, color: C.red, borderColor: "#f3c6c6" }}
                            onClick={async () => {
                              // People already inside keep working; this only stops new
                              // sign-ups on that link.
                              await revokeInvite(invite.code);
                              refresh();
                            }}
                          >
                            Withdraw
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        </>}
      </main>
    </div>
  );
}
