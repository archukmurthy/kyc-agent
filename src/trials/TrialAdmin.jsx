/**
 * TrialAdmin - where the owner makes a trial link without asking an engineer.
 *
 * Owner-only, and the server enforces that on every call. This screen being
 * hidden is convenience; the check in api/ubo-invite.js is the protection.
 * Anyone can post to that route directly, and creating invites is how somebody
 * would help themselves to our AI budget.
 *
 * Deliberately plain: a form, a table, a copy button. Three people will ever
 * use it, and a prettier version is time not spent on the product.
 */
import React, { useCallback, useEffect, useState } from "react";
import { createInvite, inviteLink, listInvites, markCustomer, setBudget, revokeInvite } from "./trialApi";

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const page = { maxWidth: 860, margin: "40px auto", padding: "0 20px", fontFamily: FONT, lineHeight: 1.5 };
const label = { display: "block", fontSize: 13, color: "#57606a", marginBottom: 4 };
const input = { padding: "8px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, width: "100%" };
const button = { padding: "9px 16px", border: 0, borderRadius: 6, background: "#1a3a4a", color: "#fff", fontSize: 14, cursor: "pointer" };
const cell = { padding: "8px 10px", borderBottom: "1px solid #eaeef2", fontSize: 13, textAlign: "left", verticalAlign: "top" };

const NO_ACCESS = "Your account is not set up yet. Whoever invited you needs to add you before you can see anything here.";

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
    return <div><button type="button" style={{ ...button, background: "#f6f8fa", color: "#24292f", border: "1px solid #d0d7de", marginTop: 6, padding: "2px 8px", fontSize: 12 }} onClick={() => { setValue(String(invite.budget)); setOpen(true); }}>Change</button></div>;
  }
  return <div style={{ marginTop: 6 }}>
    <input aria-label={`Paid AI steps for ${invite.company}`} style={{ ...input, width: 80, padding: "2px 6px" }} type="number" min="1" max="10000" value={value} onChange={(e) => setValue(e.target.value)} />
    <button type="button" style={{ ...button, padding: "2px 8px", fontSize: 12, marginLeft: 4 }} onClick={save}>Save</button>
    <button type="button" style={{ ...button, background: "#fff", color: "#24292f", border: "1px solid #d0d7de", padding: "2px 8px", fontSize: 12, marginLeft: 4 }} onClick={() => setOpen(false)}>Cancel</button>
    {error ? <div role="alert" style={{ color: "#a40e26", fontSize: 12 }}>{error}</div> : null}
  </div>;
}

export default function TrialAdmin() {
  const [invites, setInvites] = useState([]);
  const [form, setForm] = useState({ company: "", seats: 5, days: 7, budget: 100 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await listInvites();
      setInvites(result.invites || []);
      setError("");
    } catch (err) {
      // Two different 403s: "no_access" is a person nobody has added yet,
      // "forbidden" is somebody who has access but is not an owner. Telling
      // them the wrong one wastes their afternoon.
      if (err.code === "no_access") setError(NO_ACCESS);
      else if (err.status === 403) setError("Only an owner can manage trial invitations.");
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

  return (
    <div style={page}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Trial invitations</h1>
      <p style={{ color: "#57606a", marginTop: 0 }}>
        One link per company. Everyone who opens it gets their own private workspace - nobody sees anyone
        else&apos;s research.
      </p>

      {error ? (
        <div role="alert" style={{ background: "#ffebe9", border: "1px solid #ffcecb", padding: "10px 12px", borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end", marginBottom: 28 }}>
        <div>
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
          <input id="budget" style={input} type="number" min="1" max="10000" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </div>
        <button type="submit" style={button} disabled={busy}>{busy ? "Creating…" : "Create link"}</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...cell, fontWeight: 600 }}>Company</th>
            <th style={{ ...cell, fontWeight: 600 }}>Link</th>
            <th style={{ ...cell, fontWeight: 600 }}>Seats</th>
            <th style={{ ...cell, fontWeight: 600 }} title="Research runs and document readings together">Paid AI steps</th>
            <th style={{ ...cell, fontWeight: 600 }}>Days</th>
            <th style={{ ...cell, fontWeight: 600 }}></th>
          </tr>
        </thead>
        <tbody>
          {invites.length === 0 ? (
            <tr><td style={{ ...cell, color: "#57606a" }} colSpan={6}>No invitations yet.</td></tr>
          ) : invites.map((invite) => (
            <tr key={invite.code} style={{ opacity: invite.revoked ? 0.5 : 1 }}>
              <td style={cell}>
                {invite.company}
                {invite.revoked ? <div style={{ color: "#a40e26", fontSize: 12 }}>withdrawn</div> : null}
                {invite.customer ? <div style={{ color: "#1a7f37", fontSize: 12, fontWeight: 600 }}>customer - work kept</div> : null}
              </td>
              <td style={{ ...cell, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>
                {inviteLink(invite.code)}
                <div>
                  <button type="button" onClick={() => copy(invite.code)} style={{ ...button, background: "#f6f8fa", color: "#24292f", border: "1px solid #d0d7de", marginTop: 6, padding: "4px 10px", fontSize: 12 }}>
                    {copied === invite.code ? "Copied" : "Copy link"}
                  </button>
                </div>
              </td>
              <td style={cell}>{invite.seatsUsed} / {invite.seats}</td>
              <td style={cell}>
                {/* Seats say how many arrived; runs say whether they actually
                    used it. A prospect at 0 of 100 after five days is a
                    conversation to have now, not after the trial ends. */}
                <span style={invite.nearlySpent ? { color: "#a04100", fontWeight: 600 } : undefined}>
                  {invite.budgetSpent ?? 0} / {invite.budget}
                </span>
                {invite.nearlySpent ? <div style={{ fontSize: 11, color: "#a04100" }}>nearly used up</div> : null}
                <BudgetEditor invite={invite} onSaved={refresh} />
              </td>
              <td style={cell}>{invite.days}</td>
              <td style={cell}>
                {/* A non-buyer's work is deleted 90 days after the trial ends.
                    This is the only thing that keeps a buyer's. */}
                <button
                  type="button"
                  style={{ ...button, background: "#fff", color: invite.customer ? "#57606a" : "#1a7f37", border: "1px solid #d0d7de", padding: "4px 10px", fontSize: 12, marginRight: 6 }}
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
                    style={{ ...button, background: "#fff", color: "#a40e26", border: "1px solid #ffcecb", padding: "4px 10px", fontSize: 12 }}
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
