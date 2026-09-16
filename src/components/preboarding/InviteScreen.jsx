/**
 * InviteScreen.jsx — the analyst's "invite the customer" screen, the last
 * pre-boarding surface.
 *
 * Originally extracted from App.js as a pure move; since then the invite-send
 * path was fixed to email a working (dossier-backed) link — see below. Reached
 * from the ?preboarding=1 early-return block (which stays in App.js) when
 * showInviteScreen is set; it takes priority over the dossier view, and that
 * ordering lives in the routing block, not here.
 *
 * ONE LINK, dossier-backed: ?dossierId=…&journey=customer. It works cross-device
 * because the customer's mount fetches the dossier server-side (api/get-dossier).
 * The legacy ?ref=<token> link only ever rehydrated from a same-browser
 * localStorage snapshot, so it was dead the moment the customer opened the email
 * on another device — it is no longer generated or emailed. A saved dossier
 * (dossierId) is therefore REQUIRED to send an invite; Send is disabled until one
 * exists.
 *
 * THIS COMPONENT OWNS NO STATE. The invite fields and the sent/link pair are all
 * App-owned and drilled.
 */

import React from "react";

export function InviteScreen({
  research,
  companyName,
  brandName,
  tenantId,
  dossierId,
  inviteEmail,
  setInviteEmail,
  inviteContactName,
  setInviteContactName,
  inviteLink,
  setInviteLink,
  inviteSent,
  setInviteSent,
  setShowInviteScreen,
}) {
    const companyDisplayName = research?.companyName || companyName || 'the company';
    const brand = brandName || tenantId || 'the company';

    // The dossier-backed link — the single source of truth for what gets sent.
    // Only callable once a dossier is saved (dossierId truthy); callers must
    // gate on that themselves (see the Send button's disabled state below).
    function buildDossierLink() {
      const base = window.location.origin;
      return `${base}/?tenant=${tenantId}&dossierId=${dossierId}&journey=customer`;
    }

    // Sends the invite for real via /api/invite (Resend), handing it the same
    // dossier-backed link shown on screen (plus dossierId/tenantId) so the
    // server embeds THAT link in the email rather than minting its own.
    async function handleSendInvite() {
      if (!inviteEmail || !inviteContactName || !dossierId) return;
      const link = buildDossierLink();
      try {
        const resp = await fetch('/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: inviteEmail,
            contactName: inviteContactName,
            companyName: companyDisplayName,
            origin: window.location.origin,
            dossierId,
            tenantId,
            link,
          }),
        });
        const data = await resp.json();
        console.log('Invite dispatched:', { ...data, email: inviteEmail, contactName: inviteContactName });
      } catch (err) {
        console.warn('Invite send failed, email may not have been dispatched:', err);
      }

      setInviteLink(link);
      setInviteSent(true);
    }

    const emailBody = `Dear ${inviteContactName || '[Contact Name]'},

Thank you for your interest in ${brand}. We have begun reviewing your application for ${companyDisplayName} and are ready to proceed with the next step.

Please complete your onboarding by clicking the link below:

${inviteLink || '[Onboarding link will appear here]'}

This link is unique to your application. Once you click it, you will be guided through a short onboarding form. The process typically takes 10–15 minutes.

If you have any questions, please do not hesitate to reach out to your ${brand} contact.

Best regards,
${brand} Onboarding Team`;

    const stepLabels = ['Company Input', 'Research', 'Dossier Review', 'Invite Customer'];

    if (inviteSent) {
      return (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32, fontSize: 13 }}>
            {stepLabels.map((s, i) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                  background: '#1a3a4a', color: '#fff'
                }}>✓</span>
                <span style={{ color: i === 3 ? '#1a3a4a' : '#1a3a4a70', fontWeight: i === 3 ? 600 : 400 }}>{s}</span>
                {i < 3 && <span style={{ color: '#ccc' }}>›</span>}
              </span>
            ))}
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#14532d', marginBottom: 6 }}>
              Invite sent to {inviteContactName}
            </div>
            <div style={{ fontSize: 14, color: '#166534' }}>
              An onboarding invitation has been dispatched to <strong>{inviteEmail}</strong>.
            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Onboarding link
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <code style={{
                flex: 1, fontSize: 12, color: '#1a3a4a', wordBreak: 'break-all',
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px'
              }}>
                {inviteLink}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                style={{
                  padding: '8px 14px', background: '#1a3a4a', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap'
                }}
              >
                Copy link
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => {
                setInviteSent(false);
                setInviteEmail('');
                setInviteContactName('');
                setInviteLink('');
              }}
              style={{
                padding: '10px 20px', background: '#fff', color: '#1a3a4a',
                border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer'
              }}
            >
              Send another invite
            </button>
            <button
              onClick={() => setShowInviteScreen(false)}
              style={{
                padding: '10px 20px', background: '#f1f5f9', color: '#1a3a4a',
                border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer'
              }}
            >
              ← Back to dossier
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32, fontSize: 13 }}>
          {stepLabels.map((s, i) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                background: i <= 3 ? '#1a3a4a' : '#e0e0e0',
                color: i <= 3 ? '#fff' : '#999'
              }}>{i < 3 ? '✓' : i + 1}</span>
              <span style={{ color: i === 3 ? '#1a3a4a' : '#1a3a4a70', fontWeight: i === 3 ? 600 : 400 }}>{s}</span>
              {i < 3 && <span style={{ color: '#ccc' }}>›</span>}
            </span>
          ))}
        </div>

        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a3a4a', margin: '0 0 8px' }}>
            Invite customer to onboard
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            The dossier for <strong>{companyDisplayName}</strong> is ready.
            Send a personalised onboarding link to the customer contact.
          </p>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Contact name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={inviteContactName}
              onChange={e => setInviteContactName(e.target.value)}
              placeholder="e.g. Sarah Chen"
              style={{
                width: '100%', padding: '10px 14px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 14, color: '#1a3a4a', boxSizing: 'border-box', outline: 'none'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Customer email address <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="e.g. sarah@company.com"
              style={{
                width: '100%', padding: '10px 14px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 14, color: '#1a3a4a', boxSizing: 'border-box', outline: 'none'
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
            Email preview
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
              <strong>To:</strong> {inviteEmail || '[customer email]'}
              &nbsp;·&nbsp;
              <strong>Subject:</strong> Your {brand} onboarding is ready - {companyDisplayName}
            </div>
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
              <pre style={{
                fontSize: 13, color: '#374151', lineHeight: 1.7,
                margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit'
              }}>
                {emailBody}
              </pre>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowInviteScreen(false)}
            style={{
              padding: '10px 20px', background: '#fff', color: '#1a3a4a',
              border: '1px solid #ddd', borderRadius: 8, fontSize: 14, cursor: 'pointer'
            }}
          >
            ← Back to dossier
          </button>
          <button
            onClick={handleSendInvite}
            disabled={!inviteEmail || !inviteContactName || !dossierId}
            style={{
              padding: '10px 24px',
              background: (!inviteEmail || !inviteContactName || !dossierId) ? '#9ca3af' : '#1a3a4a',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: (!inviteEmail || !inviteContactName || !dossierId) ? 'not-allowed' : 'pointer'
            }}
          >
            ✉ Send invite
          </button>
          {!dossierId ? (
            <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
              Save the dossier before inviting the customer.
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              Customer receives a unique onboarding link
            </span>
          )}
        </div>
      </div>
    );
}
