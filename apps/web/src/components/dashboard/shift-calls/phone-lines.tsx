type Props = { label: string; lines: readonly string[] };

/** What Kin says, one sentence to a line, as on a phone's screen during a call. */
export function PhoneLines({ label, lines }: Props) {
  return (
    <ol aria-label={label} className="enter-stagger min-w-0 space-y-2">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`} className="min-w-0 rounded-3xl rounded-ss-md border bg-card px-4 py-3 text-base text-pretty shadow-sm">
          {line}
        </li>
      ))}
    </ol>
  );
}
