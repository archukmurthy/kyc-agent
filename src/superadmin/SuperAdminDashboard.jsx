import React, { useCallback, useEffect, useMemo, useState } from "react";
import { adminColors, adminStyles } from "../admin/adminDesign";
import TenantCard from "./components/TenantCard";
import CreateTenantModal from "./components/CreateTenantModal";
import CredentialsModal from "./components/CredentialsModal";
import ResetPasswordModal from "./components/ResetPasswordModal";

// /super-admin dashboard. Lists tenants from /api/tenants, opens modals for
// creation and password reset, toggles tenant status. Everything tenant-
// management lives here — the client /admin has been stripped of it.
export default function SuperAdminDashboard({ token, onSignOut }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showCredentials, setShowCredentials] = useState(null); // { tenantId, companyName, password, adminUrl, customerUrl }
  const [showReset, setShowReset] = useState(null); // { tenantId, companyName }
  const [searchQuery, setSearchQuery] = useState("");

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/tenants", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) {
        if (r.status === 401) {
          onSignOut();
          return;
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const data = await r.json();
      setTenants(data.tenants || []);
    } catch (err) {
      setError(err.message);
      setTenants([]);
    } finally {
      setLoading(false);
    }
  }, [token, onSignOut]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  const sortedTenants = useMemo(() => {
    const list = [...tenants];
    list.sort((a, b) => {
      // Nium always first
      if (a.tenantId === "nium") return -1;
      if (b.tenantId === "nium") return 1;
      // Then by createdAt desc
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return list.filter(
        (t) =>
          (t.tenantId || "").toLowerCase().includes(q) ||
          (t.companyName || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [tenants, searchQuery]);

  const stats = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter((t) => t.isActive !== false).length;
    const configured = tenants.filter((t) => !t.isBlank).length;
    return { total, active, configured };
  }, [tenants]);

  async function handleToggleStatus(tenant) {
    const nextActive = tenant.isActive === false;
    const verb = nextActive ? "Reactivate" : "Deactivate";
    if (!window.confirm(`${verb} ${tenant.companyName || tenant.tenantId}?`)) return;
    try {
      const r = await fetch(
        `/api/tenants?action=toggle-status&tenantId=${encodeURIComponent(tenant.tenantId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ isActive: nextActive }),
        }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      loadTenants();
    } catch (err) {
      alert("Could not update status: " + err.message);
    }
  }

  return (
    <div style={adminStyles.pageWrapper}>
      <TopBar onSignOut={onSignOut} />

      <div style={adminStyles.pageInner}>
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Tenant Management</h2>
          <p style={{ fontSize: 13, color: adminColors.textMuted, marginTop: 4 }}>
            Create and manage client tenants. Each tenant has isolated configuration and onboarding flows.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
          <StatCard label="Total Tenants" value={stats.total} />
          <StatCard label="Active" value={stats.active} accent={adminColors.statusComplete} />
          <StatCard label="Configured" value={stats.configured} accent={adminColors.niumBlue} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tenants..."
            style={{ ...adminStyles.input, maxWidth: 320 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={loadTenants} style={adminStyles.btnGhost}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
            <button type="button" onClick={() => setShowCreate(true)} style={adminStyles.btnPrimary}>
              + Create New Tenant
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: 12, background: "#fef2f2", color: adminColors.danger, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            Could not load tenants: {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sortedTenants.map((t) => (
            <TenantCard
              key={t.tenantId}
              tenant={t}
              onResetPassword={(tenant) => setShowReset({ tenantId: tenant.tenantId, companyName: tenant.companyName })}
              onToggleStatus={handleToggleStatus}
            />
          ))}
          {!sortedTenants.length && !loading && (
            <div style={{ padding: 24, fontSize: 13, color: adminColors.textMuted, textAlign: "center", background: "#fff", borderRadius: 12, border: `1px solid ${adminColors.border}` }}>
              {searchQuery ? "No tenants match your search." : "No tenants yet."}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateTenantModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={(creds) => {
            setShowCreate(false);
            setShowCredentials(creds);
            loadTenants();
          }}
        />
      )}

      {showCredentials && (
        <CredentialsModal
          {...showCredentials}
          onClose={() => setShowCredentials(null)}
        />
      )}

      {showReset && (
        <ResetPasswordModal
          tenantId={showReset.tenantId}
          companyName={showReset.companyName}
          token={token}
          onClose={() => setShowReset(null)}
          onSuccess={(creds) => {
            setShowReset(null);
            setShowCredentials(creds);
          }}
        />
      )}
    </div>
  );
}

function TopBar({ onSignOut }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        background: adminColors.niumBlue,
        color: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "#fff",
            color: adminColors.niumBlue,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          N
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Nium</div>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>|</span>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Platform Administration
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.85)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Sign out
      </button>
    </header>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${adminColors.border}`,
        borderRadius: 10,
        padding: "14px 18px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: adminColors.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent || adminColors.text, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}
