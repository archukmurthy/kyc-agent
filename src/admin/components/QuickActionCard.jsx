import React, { useState } from "react";
import { adminStyles, adminColors } from "../adminDesign";

export default function QuickActionCard({ icon, title, body, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...adminStyles.quickActionCard,
        background: hover ? adminColors.quickActionHover : adminColors.quickActionBg,
        transform: hover ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hover ? "0 4px 14px rgba(11,61,145,0.08)" : "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ fontSize: 26, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: adminColors.text }}>{title}</div>
      <div style={{ fontSize: 13, color: adminColors.textMuted, lineHeight: 1.45 }}>{body}</div>
    </button>
  );
}
