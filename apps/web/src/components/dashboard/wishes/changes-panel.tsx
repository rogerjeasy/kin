import type { ParentSubscriptionRecord } from "@kin/db";
import type { InForceWish, WishEffects } from "@kin/domain";
import { BanknoteIcon, PauseCircleIcon, RepeatIcon, UserCogIcon, UsersIcon, type LucideIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { wishCitation, type WishNameBook } from "@/components/dashboard/words/wish-words";
import type { KeptPay } from "@/content/circle/wishes";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

import { PlayWish } from "./play-wish";

type Copy = Dictionary["dashboard"]["wishes"];
type Props = {
  readonly copy: Copy;
  readonly book: WishNameBook;
  readonly format: Formatters;
  readonly locale: string;
  readonly effects: WishEffects;
  readonly kept: readonly KeptPay[];
  readonly subscriptions: readonly ParentSubscriptionRecord[];
  /** Whether the viewer may hear her words: the family may, a caregiver may not. */
  readonly mayPlay: boolean;
  /** The wishes she recorded in her own voice; the others are read by Kin's. */
  readonly recorded: readonly string[];
};

type Change = { readonly key: string; readonly icon: LucideIcon; readonly lines: readonly string[]; readonly tag: string | null; readonly wish: InForceWish };

/**
 * What changed when her wishes took effect, and why: each change is one rule
 * of hers, run as plain code, with her words and her voice beside it. Nothing
 * here decides anything; it shows what the record now says.
 */
export function ChangesPanel({ copy, book, format, locale, effects, kept, subscriptions, mayPlay, recorded }: Props) {
  const changes: Change[] = [
    ...kept.map((each) => ({
      key: `keep-${each.payeeId}`,
      icon: BanknoteIcon,
      lines: [
        fill(copy.changed.kept, { payee: book.payees[each.payeeId] ?? "?" }),
        ...each.paid.map((paid) => fill(paid.settled ? copy.changed.paid : copy.changed.onItsWay, { amount: format.money(paid.cents), payee: book.payees[each.payeeId] ?? "?", day: format.weekdayDay(paid.at) })),
        ...(each.nextShift === null ? [] : [fill(copy.changed.nextShift, { title: each.nextShift.title ?? "", day: format.dateTime(each.nextShift.startsAt) })]),
      ],
      tag: null,
      wish: each.wish,
    })),
    ...effects.subscriptions.flatMap(({ subscriptionId, wish }) => {
      const subscription = subscriptions.find((each) => each.id === subscriptionId);
      if (subscription === undefined) return [];
      // One not linked to PayPal keeps running: Kin says so, and who can stop it.
      const line = !subscription.simulated && !subscription.linked ? fill(copy.changed.notLinked, { name: subscription.name }) : fill(copy.changed.subscription[subscription.state], { name: subscription.name, amount: format.money(subscription.monthlyCents) });
      return [{ key: `subscription-${subscriptionId}`, icon: RepeatIcon, lines: [line], tag: subscription.simulated ? copy.simulated : null, wish }];
    }),
    ...(effects.discretionary === null ? [] : [{ key: "discretionary", icon: PauseCircleIcon, lines: [copy.changed.discretionary], tag: null, wish: effects.discretionary }]),
    ...effects.newPayees.map((rule) => ({
      key: `new-${rule.wish.id}`,
      icon: UsersIcon,
      lines: [fill(copy.changed.newPayees, { amount: format.money(rule.aboveCents), approvers: format.allOf(rule.approverMemberIds.map((id) => book.members[id] ?? "?")) })],
      tag: null,
      wish: rule.wish,
    })),
    ...(effects.successor === null ? [] : [{ key: "successor", icon: UserCogIcon, lines: [fill(copy.changed.successor, { member: book.members[effects.successor.memberId] ?? "?", parent: book.parent })], tag: null, wish: effects.successor.wish }]),
  ];

  return (
    <section aria-labelledby="wish-changes-title" className="flex min-w-0 flex-col gap-4">
      <div className="min-w-0">
        <h2 id="wish-changes-title" className="text-xl font-semibold text-balance">
          {copy.changed.title}
        </h2>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{copy.changed.text}</p>
      </div>
      {changes.length === 0 ? <p className="rounded-2xl border bg-card p-5 text-pretty">{copy.changed.none}</p> : null}
      <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
        {changes.map((change) => {
          const Icon = change.icon;
          const [headline, ...rest] = change.lines;
          return (
            <li key={change.key} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-5 shadow-xs">
              <div className="flex min-w-0 items-start gap-3">
                <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-positive" />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-pretty">{headline}</p>
                  {rest.map((line) => (
                    <p key={line} className="mt-1 text-pretty">
                      {line}
                    </p>
                  ))}
                </div>
                {change.tag ? <StatusPill tone="neutral">{change.tag}</StatusPill> : null}
              </div>
              <figure className="flex min-w-0 flex-col gap-2 border-s-4 border-highlight/60 ps-3">
                <figcaption className="text-sm text-pretty break-words text-muted-foreground">{wishCitation(copy, book, format, change.wish)}</figcaption>
                {mayPlay ? (
                  <PlayWish
                    wishId={change.wish.id}
                    locale={locale}
                    copy={{
                      label: fill(recorded.includes(change.wish.id) ? copy.play.recording : copy.play.readByKin, { parent: book.parent }),
                      voice: recorded.includes(change.wish.id) ? copy.play.voiceOwn : copy.play.voiceKin,
                      playing: copy.play.playing,
                      stop: copy.play.stop,
                      unavailable: copy.play.unavailable,
                    }}
                  />
                ) : null}
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
