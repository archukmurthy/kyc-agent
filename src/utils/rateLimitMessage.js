// Client copy for a 429 { error: "rate_limited", retryAfterSeconds } from any
// Claude-spending endpoint.
export function rateLimitMessage(retryAfterSeconds) {
  const seconds = Number(retryAfterSeconds);
  const minutes = Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 0) / 60));
  return `Too many requests - please try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
