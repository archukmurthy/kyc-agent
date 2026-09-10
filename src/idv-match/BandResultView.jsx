import React from "react";
import BandDialogue from "./BandDialogue";
import VerifiedFieldsConfirm from "./VerifiedFieldsConfirm";

// Renders whatever the live resolve call returned. Presentational only — the
// verbatim copy comes from the server (result.applicantView / dialogue), never
// hardcoded here. Never shows a two-version pick-one.
//
// Props:
//   result       — the /api/idv-match/resolve response
//   uploadPrompt — server-provided name-change upload prompt (dialogue round-trip)
//   onSubmitExplanation(categoryId), onUploadEvidence(categoryId, file)
//   onProvideLoa() — Band C: enter the letter-of-authorization flow (secondary)
//   onRetry()      — missing/unreadable data: recovery path
//   extraFields    — node of blank not-fetched fields, rendered under the cells
//   Btn            — optional button component
function View({ title, body, children }) {
  return (
    <div>
      {title && <h2>{title}</h2>}
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}

export default function BandResultView({ result, uploadPrompt, onSubmitExplanation, onUploadEvidence, onProvideLoa, onProceed, onConfirm, onRetry, Btn, extraFields }) {
  const Button = Btn || ((props) => <button {...props} />);
  if (!result || result.enabled === false) return null;

  if (result.needsRetry) {
    return (
      <View title="We need to check your document again" body="We couldn't read all the details we need. Please try the verification again.">
        <Button type="button" onClick={() => onRetry && onRetry()}>Try again</Button>
      </View>
    );
  }

  if (result.dialogue) {
    return (
      <BandDialogue
        dialogue={result.dialogue}
        uploadPrompt={uploadPrompt}
        onSubmit={onSubmitExplanation}
        onUpload={onUploadEvidence}
        Btn={Btn}
      />
    );
  }

  const view = result.applicantView || {};
  const isBandC = result.band === "C" || result.outcomeType === "demoted_to_loa_path" || result.route === "loa_path";
  const hasVerifiedFields = result.verifiedFields && Object.keys(result.verifiedFields).length > 0;

  return (
    <View title={view.title} body={view.body}>
      {/* Fetched identity fields after verification, editable on ANY outcome
          (tick + edit), with the blank not-fetched fields below and a single
          "Confirm & continue". Band C additionally offers the LOA path as a
          secondary action rather than a wall. */}
      {hasVerifiedFields && (
        <VerifiedFieldsConfirm
          fields={result.verifiedFields}
          onConfirm={onConfirm}
          extraFields={extraFields}
          Btn={Btn}
        />
      )}
      {!hasVerifiedFields && onProceed && (
        <Button type="button" onClick={() => onProceed()}>Continue →</Button>
      )}
      {isBandC && onProvideLoa && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => onProvideLoa()}
            style={{ background: "transparent", border: "none", color: "#0B3D91", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 14, padding: 0 }}
          >
            Provide letter of authorization instead
          </button>
        </div>
      )}
    </View>
  );
}
