// Read a File object as base64 (data: prefix stripped) for sending in an
// Anthropic messages "document" content block.
export const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Format an ISO fetch timestamp ("grabbed at" line) for the dossier. Returns ""
// for missing/unparseable values so callers can render conditionally.
export function formatFetchedAt(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (_) {
    return "";
  }
}
