"use client";

import { useState } from "react";
import { PRECISIONS, type Precision } from "@/lib/types";
import { PrecisionPicker } from "./PrecisionPicker";

export function JoinForm({ onJoin }: { onJoin: (name: string, precision: Precision) => Promise<void> }) {
  const [name, setName] = useState("");
  const [precision, setPrecision] = useState<Precision>(PRECISIONS[1].value);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card stack"
      aria-label="Join"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onJoin(name, precision);
        setBusy(false);
      }}
    >
      <h2>Join</h2>
      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="given-name" />
      </label>
      <PrecisionPicker value={precision} onChange={setPrecision} />
      <button className="btn primary" disabled={busy || !name.trim()}>
        {busy ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
