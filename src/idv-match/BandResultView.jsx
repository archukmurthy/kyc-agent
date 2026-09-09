import React from "react";
import BandDialogue from "./BandDialogue";

// Renders whatever the live resolve call returned. Presentational only — the
// verbatim copy comes from the server (result.applicantView / dialogue), never
// hardcoded here. Never shows a two-version pick-one.
//
// Props:
//   result       — the /api/idv-match/resolve response
//   uploadPrompt — server-provided name-change upload prompt (dialogue round-trip)
//   onSubmitExplanation(categoryId), onUploadEvidence(categoryId, file)
//   onProvideLoa() — Band C: enter the existing letter-of-authorization flow
//   onRetry()      — missing/unreadable data: recovery path
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

export default function BandResultView({ result, uploadPrompt, onSubmitExplanation, onUploadEvidence, onProvideLoa, onRetry, Btn }) {
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

  // Band C -> the could-not-confirm copy + the existing LOA path.
  if (result.band === "C" || result.outcomeType === "demoted_to_loa_path" || result.route === "loa_path") {
    return (
      <View title={view.title} body={view.body}>
        <Button type="button" onClick={() => onProvideLoa && onProvideLoa()}>Provide letter of authorization</Button>
      </View>
    );
  }

  // Band A success, in-review, registry note, name-change evidenced — all just
  // render their server-provided title/body.
  return <View title={view.title} body={view.body} />;
}
