import React, { useState } from "react";

// Band B one-round dialogue (Step 5c). Presentational only: it renders the
// server-provided verbatim copy and reports the chosen explanation up via
// callbacks. It never decides anything and never shows two data versions as a
// pick-one — it shows the two names for context and asks a single question.
//
// Props:
//   dialogue    — the server `result.dialogue` object: { prompt, options, submitLabel }
//   uploadPrompt — when the server asked for a name-change document, its verbatim
//                  prompt string; renders the upload affordance.
//   onSubmit(categoryId)          — applicant chose an explanation
//   onUpload(categoryId, file)    — applicant supplied the name-change document
//   Btn         — optional button component (falls back to a plain <button>)
export default function BandDialogue({ dialogue, uploadPrompt, onSubmit, onUpload, Btn }) {
  const [choice, setChoice] = useState(null);
  const [file, setFile] = useState(null);
  const Button = Btn || ((props) => <button {...props} />);
  const p = (dialogue && dialogue.prompt) || {};
  const options = (dialogue && dialogue.options) || [];

  return (
    <div>
      <h2>{p.title}</h2>
      <p>{p.intro}</p>
      <p>
        <span>{p.documentLabel}</span> <strong>{p.documentName}</strong>
        <br />
        <span>{p.companyLabel}</span> <strong>{p.companyName}</strong>
      </p>

      {uploadPrompt ? (
        <div>
          <p>{uploadPrompt}</p>
          <input type="file" aria-label="name change document" onChange={(e) => setFile(e.target.files && e.target.files[0])} />
          <Button type="button" disabled={!file} onClick={() => onUpload && onUpload("changed_name", file)}>
            Upload document
          </Button>
        </div>
      ) : (
        <fieldset>
          <legend>{p.question}</legend>
          {options.map((o) => (
            <label key={o.id} style={{ display: "block" }}>
              <input type="radio" name="idv-explanation" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
              {" "}{o.label}
            </label>
          ))}
          <Button type="button" disabled={!choice} onClick={() => onSubmit && onSubmit(choice)}>
            {dialogue && dialogue.submitLabel}
          </Button>
        </fieldset>
      )}
    </div>
  );
}
