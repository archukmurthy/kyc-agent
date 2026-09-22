/**
 * PeopleAdmin - who works here, and as what.
 *
 * An owner sees every company; an admin sees their own. This screen hides what
 * the person may not do, which is courtesy - api/ubo-people.js enforces it on
 * every call, because anyone can post to that route directly.
 *
 * People are invited by email rather than by id: nobody has a Clerk id until
 * they sign in, so "add a colleague" cannot ask for one. The invitation waits
 * until they arrive.
 *
 * Deliberately plain: a form and two tables. A handful of people will ever use
 * it, and a prettier version is time not spent on the product.
 */
import React, { useCallback, useEffect, useState } from "react";
import { cancelInvitation, changeRole, invitePerson, listPeople, removePerson } from "./peopleApi";

const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const page = { maxWidth: 900, margin: "40px auto", padding: "0 20px", fontFamily: FONT, lineHeight: 1.5 };
const label = { display: "block", fontSize: 13, color: "#57606a", marginBottom: 4 };
const input = { padding: "8px 10px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, width: "100%" };
const button = { padding: "9px 16px", border: 0, borderRadius: 6, background: "#1a3a4a", color: "#fff", fontSize: 14, cursor: "pointer" };
const quiet = { ...button, background: "#fff", color: "#a40e26", border: "1px solid #ffcecb", padding: "4px 10px", fontSize: 12 };
const cell = { padding: "8px 10px", borderBottom: "1px solid #eaeef2", fontSize: 13, textAlign: "left", verticalAlign: "top" };
const head = { ...cell, fontWeight: 600 };

const ROLE_WORDS = {
  owner: "Owner - every company, and can add other owners",
  admin: "Admin - manages this company's people",
  analyst: "Analyst - does the work",
};

export default function PeopleAdmin() {
  const [people, setPeople] = useState([]);
  const [pending, setPending] = useState([]);
  const [you, setYou] = useState(null);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState({ email: "", role: "analyst", tenantId: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = you && you.role === "owner";

  const refresh = useCallback(async () => {
    try {
      const result = await listPeople();
      setPeople(result.people || []);
      setPending(result.pending || []);
      setYou(result.you || null);
      setRoles(result.grantableRoles || []);
      setError("");
    } catch (err) {
      // A 403 here means they are an analyst. Say so, rather than showing an
      // empty table that reads as "nobody works here".
      setError(err.status === 403 ? "Only an owner or an admin can manage people." : err.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function act(work) {
    setBusy(true);
    try {
      await work();
      setError("");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!form.email.trim()) { setError("An email address is required."); return; }
    return act(async () => {
      await invitePerson({
        email: form.email.trim(),
        role: form.role,
        // Only an owner may name a company; for an admin the server uses theirs
        // and refuses anything else.
        tenantId: isOwner ? form.tenantId.trim() : undefined,
      });
      setForm({ ...form, email: "" });
    });
  }

  return (
    <div style={page}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>People</h1>
      <p style={{ color: "#57606a", marginTop: 0 }}>
        {isOwner
          ? "Everyone with access, across every company."
          : "Everyone with access to your company. Invite a colleague by email - they get in the first time they sign in."}
      </p>

      {error ? (
        <div role="alert" style={{ background: "#ffebe9", border: "1px solid #ffcecb", padding: "10px 12px", borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: isOwner ? "2fr 1fr 1fr auto" : "2fr 1fr auto", gap: 12, alignItems: "end", marginBottom: 28 }}>
        <div>
          <label style={label} htmlFor="email">Email address</label>
          <input id="email" style={input} value={form.email} placeholder="colleague@company.com" onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label style={label} htmlFor="role">Role</label>
          <select id="role" style={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        {isOwner ? (
          <div>
            <label style={label} htmlFor="tenantId">Company</label>
            <input id="tenantId" style={input} value={form.tenantId} placeholder="acme" onChange={(e) => setForm({ ...form, tenantId: e.target.value })} />
          </div>
        ) : null}
        <button type="submit" style={button} disabled={busy}>{busy ? "Sending…" : "Invite"}</button>
      </form>

      <p style={{ color: "#57606a", fontSize: 13, marginTop: -16, marginBottom: 24 }}>
        {ROLE_WORDS[form.role]}
      </p>

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>With access</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 32 }}>
        <thead>
          <tr>
            <th style={head}>Person</th>
            {isOwner ? <th style={head}>Company</th> : null}
            <th style={head}>Role</th>
            <th style={head}>Added</th>
            <th style={head}></th>
          </tr>
        </thead>
        <tbody>
          {people.length === 0 ? (
            <tr><td style={{ ...cell, color: "#57606a" }} colSpan={isOwner ? 5 : 4}>Nobody yet.</td></tr>
          ) : people.map((person) => {
            const isYou = you && person.userId === you.userId;
            return (
              <tr key={person.userId}>
                <td style={cell}>
                  {person.email || <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{person.userId}</span>}
                  {isYou ? <span style={{ color: "#57606a" }}> (you)</span> : null}
                </td>
                {isOwner ? <td style={cell}>{person.tenantId || "-"}</td> : null}
                <td style={cell}>
                  {isYou || person.source === "bootstrap" ? person.role : (
                    <select
                      aria-label={`Role for ${person.email || person.userId}`}
                      style={{ ...input, width: "auto" }}
                      value={person.role}
                      disabled={busy}
                      onChange={(e) => act(() => changeRole(person.userId, e.target.value))}
                    >
                      {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  )}
                </td>
                <td style={cell}>{(person.addedAt || "").slice(0, 10) || "-"}</td>
                <td style={cell}>
                  {isYou ? null : person.source === "bootstrap" ? (
                    // The deployment configuration wins over anything stored, so
                    // there is nothing this screen could remove.
                    <span style={{ color: "#57606a", fontSize: 12 }}>set in configuration</span>
                  ) : (
                    <button type="button" style={quiet} disabled={busy} onClick={() => act(() => removePerson(person.userId))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Invited, not yet signed in</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={head}>Email</th>
            {isOwner ? <th style={head}>Company</th> : null}
            <th style={head}>Role</th>
            <th style={head}></th>
          </tr>
        </thead>
        <tbody>
          {pending.length === 0 ? (
            <tr><td style={{ ...cell, color: "#57606a" }} colSpan={isOwner ? 4 : 3}>No invitations waiting.</td></tr>
          ) : pending.map((invitation) => (
            <tr key={invitation.email}>
              <td style={cell}>{invitation.email}</td>
              {isOwner ? <td style={cell}>{invitation.tenantId || "-"}</td> : null}
              <td style={cell}>{invitation.role}</td>
              <td style={cell}>
                <button type="button" style={quiet} disabled={busy} onClick={() => act(() => cancelInvitation(invitation.email))}>
                  Withdraw
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
