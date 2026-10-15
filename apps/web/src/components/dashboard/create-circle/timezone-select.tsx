"use client";

import { useEffect, useState } from "react";

import { inputClass } from "./field";

type TimezoneSelectProps = { id: string; name: string; describedBy: string; zones: readonly string[] };

const FALLBACK = "UTC";

/** Every timezone, starting on the one the person's own device is in. */
export function TimezoneSelect({ id, name, describedBy, zones }: TimezoneSelectProps) {
  const [zone, setZone] = useState(FALLBACK);
  useEffect(() => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zones.includes(own)) setZone(own);
  }, [zones]);
  return (
    <select id={id} name={name} aria-describedby={describedBy} value={zone} onChange={(event) => setZone(event.target.value)} className={inputClass}>
      {zones.map((each) => (
        <option key={each} value={each}>
          {each.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
