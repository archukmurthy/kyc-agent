// Fixed-top amber strip shown while demo mode is on. Stacks below the
// Preview banner via the offsetTop prop so both can coexist (admin running
// a preview of a demo flow).
export function DemoBanner({ offsetTop = 0 }) {
  return (
    <div style={{
      position: "fixed",
      top: offsetTop,
      left: 0,
      right: 0,
      zIndex: 9998,
      background: "#FCD34D",
      color: "#92400E",
      textAlign: "center",
      padding: "6px",
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.3px",
      fontFamily: "inherit",
    }}>
      🧪 DEMO MODE — Sample data only. Not real company information.
    </div>
  );
}
