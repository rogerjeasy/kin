import { useId } from "react";

type Props = { seatId: string; label: string; hint: string };

/**
 * For a parent's invitation while the circle holds a parent seat nobody has
 * signed in to: the organizer says, on purpose, that this person takes it. The
 * database checks the seat again and binds it only to this invitation.
 */
export function ParentSeatChoice({ seatId, label, hint }: Props) {
  const hintId = useId();
  return (
    <label className="flex min-h-11 items-start gap-3 text-base">
      <input type="checkbox" name="seat" value={seatId} aria-describedby={hintId} className="mt-1 size-5 shrink-0 accent-primary" />
      <span className="min-w-0">
        <span className="block font-medium text-pretty">{label}</span>
        <span id={hintId} className="mt-1 block text-sm text-muted-foreground text-pretty">
          {hint}
        </span>
      </span>
    </label>
  );
}
