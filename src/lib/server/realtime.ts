/**
 * Tell everyone watching an event that it changed. The message carries no
 * data; clients refetch through the API. Uses Supabase Realtime broadcast
 * over REST, so the server never holds a socket open.
 */
export async function broadcastChanged(eventId: string, version: number): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: `event:${eventId}`, event: "changed", payload: { version } }] }),
    });
  } catch {
    // Clients also poll, so a missed broadcast only delays the update.
  }
}
