import type { WishTriggerRecord } from "@kin/db";
import { mayAttest, type CircleRole } from "@kin/domain";
import { HeartPulseIcon } from "lucide-react";

import type { WishNameBook } from "@/components/dashboard/words/wish-words";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AttestButtons } from "./attest-buttons";
import { FineButton } from "./fine-button";

type Copy = Dictionary["dashboard"]["wishes"];
type Props = {
  readonly copy: Copy;
  readonly book: WishNameBook;
  readonly format: Formatters;
  readonly open: WishTriggerRecord | null;
  readonly ended: WishTriggerRecord | null;
  readonly viewer: {
    readonly memberId: string;
    readonly role: CircleRole;
    readonly mayAttest: boolean;
    readonly maySayFine: boolean;
    /** Whether her wishes would raise or protect the viewer if each event started, so their word does not count toward it. */
    readonly gains: Readonly<Record<"hospital" | "care_home", boolean>>;
  };
  /** Who still must say so for the open trigger: anyone who may, or someone from the family. */
  readonly needs: { readonly start: "none" | "family" | "anyone" };
};

const EVENTS = ["hospital", "care_home"] as const;

/**
 * When her wishes apply: only when people say so. The panel says who said
 * what and when, offers the viewer their own word, and never offers the parent
 * or an observer a way to set it off.
 */
export function TriggerPanel({ copy, book, format, open, ended, viewer, needs }: Props) {
  const parent = book.parent;
  const said = (stance: "start" | "end") => open?.attestations.some((each) => each.memberId === viewer.memberId && each.stance === stance) ?? false;
  const who = (stance: "start" | "end") => format.allOf((open?.attestations ?? []).filter((each) => each.stance === stance).map((each) => book.members[each.memberId] ?? "?"));
  const first = (stance: "start" | "end") => book.members[(open?.attestations ?? []).find((each) => each.stance === stance)?.memberId ?? ""] ?? "?";
  const can = (event: "hospital" | "care_home") => viewer.mayAttest && mayAttest(viewer.role, event);
  // Someone who stands to gain is never offered the word that would start it; saying she is home gains them nothing.
  const canStart = (event: "hospital" | "care_home") => can(event) && !viewer.gains[event];
  const gainsHere = open === null ? EVENTS.some((event) => can(event) && viewer.gains[event]) : open.state === "reported" && can(open.event) && viewer.gains[open.event];
  const active = open?.state === "active";
  const tone = active ? "border-gold/60 bg-highlight/10 shadow-[0_0_48px_-18px_rgb(var(--glow-gold)/0.9)]" : open ? "border-gold/50 bg-card shadow-[0_0_40px_-20px_rgb(var(--glow-gold)/0.8)]" : "bg-card shadow-xs";

  const says =
    open === null
      ? EVENTS.filter(canStart).map((event) => ({ event, stance: "start" as const, label: fill(copy.trigger.report[event], { parent }) }))
      : open.state === "reported"
        ? canStart(open.event) && !said("start")
          ? [{ event: open.event, stance: "start" as const, label: fill(copy.trigger.report[open.event], { parent }) }]
          : []
        : can(open.event) && !said("end")
          ? [{ event: open.event, stance: "end" as const, label: fill(copy.trigger.home, { parent }) }]
          : [];
  const dismissable = open?.state === "reported" && (viewer.role === "organizer" || open.reportedBy === viewer.memberId);

  return (
    <section aria-labelledby="wish-trigger-title" className={cn("flex min-w-0 flex-col gap-4 rounded-3xl border p-5 sm:p-6", tone)}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-gold/15 text-highlight ring-1 ring-gold/40", open !== null && "motion-safe:animate-glow-pulse")}>
          <HeartPulseIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="wish-trigger-title" className="text-lg font-semibold text-balance">
            {fill(copy.trigger.title, { parent })}
          </h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">{copy.trigger.text}</p>
        </div>
      </div>
      {open !== null ? (
        <div role="status" className="flex min-w-0 flex-col gap-1">
          <p className="text-lg font-semibold text-pretty">
            {open.state === "reported"
              ? fill(needs.start === "family" ? copy.trigger.reportedFamily : copy.trigger.reported, { name: first("start"), parent, where: copy.trigger.where[open.event] })
              : fill(copy.trigger.active, { parent, where: copy.trigger.where[open.event], when: format.dateTime(open.activeAt ?? open.reportedAt) })}
          </p>
          <p className="text-sm text-muted-foreground">{fill(copy.trigger.attestedBy, { names: who("start") })}</p>
          {active && open.attestations.some((each) => each.stance === "end") ? <p className="mt-1 text-pretty">{fill(copy.trigger.endWaiting, { name: first("end"), parent })}</p> : null}
          {said(active ? "end" : "start") ? <p className="text-sm font-semibold">{copy.trigger.youSaid}</p> : null}
        </div>
      ) : ended !== null && ended.closedAt !== null ? (
        <p role="status" className="text-pretty">
          {fill(copy.trigger.ended, { parent, day: format.longDay(ended.closedAt) })}
        </p>
      ) : null}
      {says.length > 0 || dismissable ? (
        <AttestButtons says={says} dismiss={dismissable && open !== null ? { triggerId: open.id, label: copy.trigger.dismiss } : null} reasons={copy.reasons} />
      ) : null}
      {viewer.maySayFine && open !== null ? <FineButton label={copy.trigger.fine} note={copy.trigger.fineNote} reasons={copy.reasons} /> : null}
      {viewer.role === "parent" ? <p className="text-sm text-pretty text-muted-foreground">{copy.trigger.parentNote}</p> : null}
      {viewer.role === "observer" ? <p className="text-sm text-pretty text-muted-foreground">{copy.trigger.observer}</p> : null}
      {gainsHere ? <p className="text-sm text-pretty text-muted-foreground">{fill(copy.trigger.standsToGain, { parent })}</p> : null}
      {viewer.role === "caregiver" && open === null && !gainsHere ? <p className="text-sm text-pretty text-muted-foreground">{fill(copy.trigger.caregiverHospital, { parent })}</p> : null}
    </section>
  );
}
