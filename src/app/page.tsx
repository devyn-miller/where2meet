"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { keys, storage } from "@/lib/client/storage";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { event, organizerToken } = await api.createEvent(name, when ? new Date(when).toISOString() : null);
      storage.set(keys.organizer(event.id), organizerToken);
      // The organizer token travels in the fragment, which browsers never send to servers.
      router.push(`/e/${event.id}#org=${organizerToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the event.");
      setBusy(false);
    }
  }

  return (
    <main className="home">
      <h1>where2meet</h1>
      <p className="lede">
        Find a fair place to meet. Share a link, everyone drops a pin at the precision they choose, and the center updates
        live.
      </p>
      <form onSubmit={submit} className="card stack">
        <label className="field">
          <span>Event name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="Saturday lunch" />
        </label>
        <label className="field">
          <span>
            Meeting date and time <small>(optional, unlocks drive-time mode)</small>
          </span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create event"}
        </button>
      </form>
      <p className="muted small">No accounts. You get a share link and a private organizer link.</p>
    </main>
  );
}
