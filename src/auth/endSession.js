/**
 * Ending a staff session properly.
 *
 * Clearing the browser's copy of the token is only half of signing out - until
 * the server is told, the token still works for anyone holding a copy of it.
 * That half could not exist before AUTH-2, when the token was the password and
 * "ending a session" meant changing it for everybody.
 *
 * Deliberately never throws and never blocks: the browser forgets the token
 * either way, and a sign-out that appears to fail leaves somebody unsure
 * whether they are still signed in.
 */
export async function endSession(token) {
  if (!token) return;
  try {
    await fetch("/api/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: "{}",
      // The page is about to reload; let the request outlive it.
      keepalive: true,
    });
  } catch (_) {
    // Offline, or the server is down. The local token is cleared regardless,
    // and the session expires on its own.
  }
}
