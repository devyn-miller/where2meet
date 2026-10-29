"use client";

import { PRECISIONS, type Precision } from "@/lib/types";

export function PrecisionPicker({ value, onChange }: { value: Precision; onChange: (p: Precision) => void }) {
  return (
    <fieldset className="seg wrap">
      <legend>How precisely to share your location</legend>
      {PRECISIONS.map((p) => (
        <label key={p.value}>
          <input type="radio" name="precision" checked={value === p.value} onChange={() => onChange(p.value)} />
          <span>
            {p.label} <small>{p.hint}</small>
          </span>
        </label>
      ))}
      <small className="muted">
        Your point is rounded on this device before it is sent. The shaded square on the map is exactly what others see.
      </small>
    </fieldset>
  );
}
