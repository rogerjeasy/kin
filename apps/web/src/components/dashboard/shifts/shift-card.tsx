import { CalendarClockIcon, CarIcon, CheckCircle2Icon, ClockIcon, HandHeartIcon, HouseIcon, StethoscopeIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";

import { IconTile } from "@/components/dashboard/ui/icon-tile";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { ShiftChip, ShiftView } from "@/content/circle/shift-views";
import type { ShiftCopy } from "@/content/circle/shift-words";
import type { CircleNames } from "@/content/circle/names";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ShiftCancel } from "./shift-cancel";
import { ShiftExtras, type ShiftExtrasScope } from "./shift-extras";
import { ShiftKeys } from "./shift-keys";
import { ShiftPayment } from "./shift-payment";

type Props = {
  view: ShiftView;
  copy: ShiftCopy;
  format: Formatters;
  names: CircleNames;
  /** Whether the family's word is the parent's own, which is what the card says it waits for. */
  parentDecides: boolean;
  approvalsHref: string;
  /** The credit line, Kin's call, and the link and call buttons, which the page decides for every card at once. */
  extras: ShiftExtrasScope;
};

const KIND_ICONS = { aide: HandHeartIcon, visit: HouseIcon, appointment: StethoscopeIcon, drive: CarIcon } as const satisfies Record<string, LucideIcon>;

const CHIP_LOOK: Record<ShiftChip, { tone: PillTone; icon: LucideIcon }> = {
  scheduled: { tone: "neutral", icon: ClockIcon },
  checked_in: { tone: "waiting", icon: ClockIcon },
  checked_out: { tone: "waiting", icon: ClockIcon },
  confirmed: { tone: "positive", icon: CheckCircle2Icon },
  priced: { tone: "positive", icon: CheckCircle2Icon },
  paid: { tone: "positive", icon: CheckCircle2Icon },
  cancelled: { tone: "neutral", icon: ClockIcon },
  awaits_approval: { tone: "waiting", icon: ClockIcon },
  being_paid: { tone: "positive", icon: CheckCircle2Icon },
  declined: { tone: "danger", icon: TriangleAlertIcon },
  payment_failed: { tone: "danger", icon: TriangleAlertIcon },
  credited: { tone: "positive", icon: CheckCircle2Icon },
};

/** The light along a card's top edge, by how far the shift has come. Decorative: the pill says it in words. */
const EDGE: Record<PillTone, string> = {
  positive: "bg-positive",
  waiting: "bg-gold",
  danger: "bg-danger",
  neutral: "bg-border",
};

/** One shift of the week: who and what, when, what it waits for, the two keys, the price and where the payment stands. */
export function ShiftCard({ view, copy, format, names, parentDecides, approvalsHref, extras }: Props) {
  const { shift } = view;
  const Icon = KIND_ICONS[shift.kind];
  const look = CHIP_LOOK[view.chip];
  const person = names.member(shift.memberId);
  const keyed = shift.kind === "aide" || shift.kind === "visit";
  const waitsFor = shift.waitingFor === null ? null : shift.waitingFor === "family_word" ? (parentDecides ? fill(copy.waiting.family_word, { parent: names.parent }) : copy.waiting.family_word_any) : fill(copy.waiting[shift.waitingFor], { name: person });
  const when = fill(copy.when, { day: format.weekdayDay(shift.startsAt), start: format.time(shift.startsAt), end: format.time(shift.endsAt) });

  const cancelled = view.tone === "cancelled";
  return (
    <li id={`shift-${shift.id}`} tabIndex={-1} className={cn("surface lift glow-edge relative min-w-0 space-y-4 overflow-clip rounded-3xl p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-6", cancelled && "border-dashed bg-muted shadow-none")}>
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", cancelled ? "bg-transparent" : EDGE[look.tone])} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-44 items-start gap-3.5">
          <IconTile icon={Icon} className={cn(look.tone === "positive" && "bg-positive/10 text-positive", look.tone === "waiting" && "bg-highlight/10 text-highlight")} />
          <div className="min-w-0">
            <h3 className={cn("text-lg font-semibold tracking-tight text-pretty", cancelled && "line-through decoration-muted-foreground/60")}>{shift.title ?? copy.kinds[shift.kind]}</h3>
            <p className="text-sm text-muted-foreground text-pretty">{person} · {copy.kinds[shift.kind]}</p>
            <p className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-sm tabular-nums">
              <CalendarClockIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{when}</span>
            </p>
          </div>
        </div>
        <StatusPill tone={look.tone} icon={look.icon}>{copy.chips[view.chip]}</StatusPill>
      </div>
      {waitsFor !== null && !cancelled ? <p className="text-sm font-medium text-pretty">{waitsFor}</p> : null}
      {keyed && !cancelled ? <ShiftKeys view={view} copy={copy} format={format} caregiver={person} familyName={shift.familyConfirmedBy === null ? null : names.member(shift.familyConfirmedBy)} /> : null}
      <ShiftExtras view={view} scope={extras} copy={copy} format={format} names={names} />
      <ShiftPayment view={view} copy={copy} format={format} caregiver={person} parent={names.parent} approvalsHref={approvalsHref} />
      {view.canCancel ? <ShiftCancel shiftId={shift.id} copy={copy} /> : null}
    </li>
  );
}
