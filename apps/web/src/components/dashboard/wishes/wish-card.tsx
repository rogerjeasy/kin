import type { WishRecord } from "@kin/db";
import { CheckCircle2Icon, ClockIcon, HistoryIcon, UndoIcon } from "lucide-react";

import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import { shortSeal, wishReadBack, type WishNameBook, type WishVoice } from "@/components/dashboard/words/wish-words";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PlayWish } from "./play-wish";
import { WishActions } from "./wish-actions";

type Copy = Dictionary["dashboard"]["wishes"];
type Props = {
  readonly copy: Copy;
  readonly wish: WishRecord;
  readonly history: readonly WishRecord[];
  readonly book: WishNameBook;
  readonly format: Formatters;
  readonly locale: string;
  readonly voice: WishVoice;
  readonly can: { readonly witness: boolean; readonly withdraw: boolean; readonly change: string | null };
};

const TONES: Record<WishRecord["state"], PillTone> = { draft: "neutral", confirmed: "waiting", in_force: "positive", superseded: "neutral", withdrawn: "neutral" };
const ICONS = { draft: ClockIcon, confirmed: ClockIcon, in_force: CheckCircle2Icon, superseded: HistoryIcon, withdrawn: UndoIcon } as const;

/** One of her wishes: her words first and large, one tap from her voice, then what Kin does with them, who confirmed it, and its seal. */
export function WishCard({ copy, wish, history, book, format, locale, voice, can }: Props) {
  const own = voice === "you";
  const readBack = wishReadBack(copy, book, format, wish, voice);
  const parentSigned = wish.signatures.some((signature) => signature.capacity === "parent");
  // In the order the members joined: two witnesses can sign in the same second on the demo's clock.
  const memberOrder = Object.keys(book.members);
  const witnesses = wish.signatures
    .filter((signature) => signature.capacity === "witness")
    .toSorted((a, b) => memberOrder.indexOf(a.memberId) - memberOrder.indexOf(b.memberId))
    .map((signature) => book.members[signature.memberId] ?? "?");
  const signed = !parentSigned
    ? copy.notConfirmed
    : wish.state === "in_force" || witnesses.length >= 2
      ? fill(copy.signed, { parent: book.parent, names: format.allOf(witnesses) })
      : fill(copy.waitingWitnesses, { parent: book.parent, count: format.count(witnesses.length) });
  const live = wish.state !== "superseded" && wish.state !== "withdrawn";
  return (
    <article aria-labelledby={`wish-${wish.id}`} className={cn("flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6", !live && "opacity-80")}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{fill(own ? copy.saidOwn : copy.said, { parent: book.parent, day: format.dayWithYear(wish.saidOn) })}</p>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={TONES[wish.state]} icon={ICONS[wish.state]}>
            {copy.states[wish.state]}
          </StatusPill>
          {wish.simulated ? <StatusPill tone="neutral">{copy.simulated}</StatusPill> : null}
        </div>
      </div>
      {/* Her words keep their own direction, whatever the screen's language. */}
      <blockquote id={`wish-${wish.id}`} dir="auto" className={cn("font-semibold text-balance break-words", own ? "text-2xl leading-snug sm:text-3xl" : "text-xl leading-snug sm:text-2xl")}>
        “{wish.quote}”
      </blockquote>
      <PlayWish
        wishId={wish.id}
        locale={locale}
        size={own ? "large" : "default"}
        copy={{
          label: fill(wish.recordingId === null ? copy.play.readByKin : copy.play.recording, { parent: book.parent }),
          voice: wish.recordingId === null ? copy.play.voiceKin : copy.play.voiceOwn,
          playing: copy.play.playing,
          stop: copy.play.stop,
          unavailable: copy.play.unavailable,
        }}
      />
      <dl className="grid min-w-0 gap-3 rounded-xl bg-secondary/40 p-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{copy.card.when}</dt>
          <dd className={cn("mt-1 text-pretty", own && "text-lg")}>{readBack.when}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{copy.card.does}</dt>
          <dd className={cn("mt-1 text-pretty", own && "text-lg")}>{readBack.does}</dd>
        </div>
      </dl>
      <div className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground">
        <p className="text-pretty">{signed}</p>
        <p className="font-mono text-xs break-all">
          {fill(copy.version, { version: format.count(wish.version) })} · {fill(copy.seal, { digest: shortSeal(wish.digest) })}
        </p>
      </div>
      <WishActions wishId={wish.id} copy={copy} can={can} witnessHint={fill(copy.actions.witnessHint, { parent: book.parent })} large={own} />
      {history.length > 0 ? (
        <details className="group min-w-0 rounded-xl border px-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{copy.history}</summary>
          <ol className="flex flex-col gap-3 pb-4">
            {history.map((earlier) => (
              <li key={earlier.id} className="min-w-0 border-t pt-3 text-sm">
                <p className="text-muted-foreground">
                  {fill(copy.version, { version: format.count(earlier.version) })} · {copy.states[earlier.state]} · {format.dayWithYear(earlier.saidOn)}
                </p>
                <p dir="auto" className="mt-1 text-pretty break-words">“{earlier.quote}”</p>
                <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{fill(copy.seal, { digest: shortSeal(earlier.digest) })}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}
