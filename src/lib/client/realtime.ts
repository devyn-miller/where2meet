import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

export const realtimeConfigured = () => getClient() !== null;

/**
 * Subscribe to "something changed" pings for an event. Returns an
 * unsubscribe function, or null when Supabase isn't configured.
 */
export function subscribeToEvent(eventId: string, onChange: () => void): (() => void) | null {
  const c = getClient();
  if (!c) return null;
  const channel = c
    .channel(`event:${eventId}`)
    .on("broadcast", { event: "changed" }, () => onChange())
    .subscribe();
  return () => {
    void c.removeChannel(channel);
  };
}
