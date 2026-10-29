"use client";

import { useEffect, useState } from "react";

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // clipboard blocked; the field is selectable
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

export function ShareBox({ eventId, organizerToken }: { eventId: string; organizerToken: string | null }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const share = `${origin}/e/${eventId}`;
  return (
    <section className="card stack" aria-label="Links">
      <CopyField label="Share link" value={share} hint="Anyone with this link can add their own pin." />
      {organizerToken && (
        <CopyField
          label="Organizer link (keep private)"
          value={`${share}#org=${organizerToken}`}
          hint="Lets you change weights, the meeting time and mode, or remove people."
        />
      )}
    </section>
  );
}
