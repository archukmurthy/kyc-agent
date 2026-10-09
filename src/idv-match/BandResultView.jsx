import React from "react";
import BandDialogue from "./BandDialogue";
import VerifiedFieldsConfirm from "./VerifiedFieldsConfirm";

// Renders whatever the live resolve call returned. Presentational only - the
// verbatim copy comes from the server (result.applicantView / dialogue), never
// hardcoded here. Never shows a two-version pick-one.
//
// Props:
//   result       - the /api/idv-match/resolve response
//   uploadPrompt - server-provided name-change upload prompt (dialogue round-trip)
//   onSubmitExplanation(categoryId), onUploadEvidence(categoryId, file)
//   onProvideLoa() - Band C: enter the letter-of-authorization flow (secondary)
//   onRetry()      - missing/unreadable data: recovery path
//   extraFields    - node of blank not-fetched fields, rendered under the cells
//   Btn            - optional button component
function View({ title, body, children }) {
  return (
    <div>
      {title && <h2>{title}</h2>}
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}

export default function BandResultView({ result, uploadPrompt, onSubmitExplanation, onUploadEvidence, onProvideLoa, onProceed, onConfirm, onRetry, Btn, extraFields, loaUpload, loaUploaded = false }) {
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

  // A review-required outcome (hard exclusion - e.g. a sanctions/PEP/adverse-media
  // screening hit) is a HARD STOP: show the neutral review copy only. No confirm,
  // no continue, no letter-of-authorization flow - the applicant cannot proceed
  // past a flagged case (back-office review takes over).
  if (result.requiresReview === true || result.outcomeType === "unresolved_to_review") {
    return <View title={view.title} body={view.body} />;
  }

  const isBandC = result.band === "C" || result.outcomeType === "demoted_to_loa_path" || result.route === "loa_path";
  const hasVerifiedFields = result.verifiedFields && Object.keys(result.verifiedFields).length > 0;
  // Band C is a person-mismatch: the applicant MUST upload a letter of
  // authorization before they can continue - Confirm stays disabled until then.
  const loaGate = isBandC && !loaUploaded;

  return (
    <View title={view.title} body={view.body}>
      {/* Fetched identity fields after verification, editable on ANY outcome
          (tick + edit), with the blank not-fetched fields below and a single
          "Confirm & continue". On Band C the letter-of-authorization upload is
          rendered inline and Continue is gated on it. */}
      {hasVerifiedFields && (
        <VerifiedFieldsConfirm
          fields={result.verifiedFields}
          onConfirm={onConfirm}
          extraFields={isBandC ? <>{extraFields}{loaUpload}</> : extraFields}
          confirmDisabled={loaGate}
          disabledNote="Upload your letter of authorization above to continue."
          Btn={Btn}
        />
      )}
      {!hasVerifiedFields && isBandC && onProvideLoa && (
        <Button type="button" onClick={() => onProvideLoa()}>Provide letter of authorization</Button>
      )}
      {!hasVerifiedFields && !isBandC && onProceed && (
        <Button type="button" onClick={() => onProceed()}>Continue →</Button>
      )}
    </View>
  );
}
