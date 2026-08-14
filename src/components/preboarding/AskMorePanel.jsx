/**
 * AskMorePanel.jsx — the analyst "ask for more information" surface.
 *
 * EXTRACTED FROM App.js as a PURE MOVE, zero behaviour change. Two bodies moved
 * together because one wraps the other: AskMoreButton renders the toggle and, when
 * open, the panel. Mounted from the dossier's Customer Request section.
 *
 * THIS COMPONENT OWNS NO STATE. The open-section key and the in-progress question
 * both live in App.js — the question is read by the dossier payload, so it cannot
 * move here.
 */

import React from "react";
import { C } from "../../constants/theme";
import { StableInput } from "../inputs/StableInput";

export function AskMoreButton({
  sectionName,
  askMoreOpenSection,
  setAskMoreOpenSection,
  newQuestion,
  setNewQuestion,
  setCustomQuestions,
}) {
  const renderAskMorePanel = (sectionName) => (
    <div style={{ marginTop: 12, padding: "16px", background: "#F3F0FF", border: "1.5px solid #7C3AED", borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED", marginBottom: 12 }}>
        Add a custom question to this section
      </div>

      <div style={{ marginBottom: 10 }}>
        <StableInput
          id={`pb_q_text_${sectionName}`}
          label="Question *"
          type="text"
          value={newQuestion.text}
          onUpdate={(_, v) => setNewQuestion((prev) => ({ ...prev, text: v }))}
          placeholder="e.g. Please provide your primary banking relationship"
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#7C3AED", marginBottom: 4 }}>Answer type</label>
        <select
          value={newQuestion.fieldType}
          onChange={(e) => setNewQuestion((prev) => ({ ...prev, fieldType: e.target.value }))}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #DDD6FE", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", cursor: "pointer" }}
        >
          <option value="text">Text (free form)</option>
          <option value="yesno">Yes / No</option>
          <option value="date">Date</option>
          <option value="number">Number</option>
          <option value="select">Select (multiple choice)</option>
          <option value="textarea">Long text</option>
        </select>
      </div>

      {newQuestion.fieldType === "select" && (
        <div style={{ marginBottom: 10 }}>
          <StableInput
            id={`pb_q_opts_${sectionName}`}
            label="Options (comma separated)"
            type="text"
            value={newQuestion.options}
            onUpdate={(_, v) => setNewQuestion((prev) => ({ ...prev, options: v }))}
            placeholder="Option 1, Option 2, Option 3"
          />
        </div>
      )}

      <div
        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer" }}
        onClick={() => setNewQuestion((prev) => ({ ...prev, required: !prev.required }))}
      >
        <input type="checkbox" checked={newQuestion.required} onChange={() => {}} style={{ accentColor: "#7C3AED", width: 14, height: 14 }} />
        <span style={{ fontSize: 12, color: "#7C3AED", fontWeight: 500 }}>Required field</span>
      </div>

      <button
        onClick={() => {
          if (!newQuestion.text.trim()) return;
          const question = {
            id: Math.random().toString(36).slice(2, 10),
            section: sectionName,
            question: newQuestion.text.trim(),
            fieldType: newQuestion.fieldType,
            required: newQuestion.required,
            options: newQuestion.fieldType === "select"
              ? newQuestion.options.split(",").map((o) => o.trim()).filter(Boolean)
              : [],
            addedAt: new Date().toISOString(),
            source: "analyst",
          };
          setCustomQuestions((prev) => [...prev, question]);
          setNewQuestion({ text: "", fieldType: "text", required: true, options: "" });
          setAskMoreOpenSection(null);
        }}
        disabled={!newQuestion.text.trim()}
        style={{ padding: "9px 20px", background: newQuestion.text.trim() ? "#7C3AED" : C.border, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: newQuestion.text.trim() ? "pointer" : "not-allowed" }}
      >
        Add question
      </button>
    </div>
  );

    const isOpen = askMoreOpenSection === sectionName;
    return (
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setAskMoreOpenSection(isOpen ? null : sectionName)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "transparent", color: "#7C3AED", border: "1.5px dashed #7C3AED", borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s" }}
        >
          <span>{isOpen ? "✕" : "+"}</span>
          {isOpen ? "Cancel" : "Ask for more information"}
        </button>
        {isOpen && renderAskMorePanel(sectionName)}
      </div>
    );
}
