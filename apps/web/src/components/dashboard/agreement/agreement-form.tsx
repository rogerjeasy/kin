"use client";

import type { AgreementChange } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Panel } from "@/components/dashboard/ui/panel";
import { changeWords } from "@/components/dashboard/words/agreement-words";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";

import { ChangeList } from "./change-list";
import { draftRequest, type Draft } from "./draft";
import { ShareFields } from "./share-fields";
import { TermFields } from "./term-fields";
import { useAgreementRequest } from "./use-agreement-request";

type Props = {
  locale: Locale;
  currency: string;
  copy: Dictionary["dashboard"]["agreement"];
  /** The members who may hold a share, in the order the form lists them. */
  members: readonly { id: string; name: string }[];
  /** Every member's name, for changes that name someone who no longer shares. */
  names: Readonly<Record<string, string>>;
  parent: string;
  /** Whether the circle has a version in force yet: the form then writes the first. */
  first: boolean;
  nextVersion: number;
  today: string;
  initial: Draft;
};

/**
 * An organizer writes a new version. The server checks the terms and says
 * exactly what changes; only then can it be proposed. Proposing changes
 * nothing yet: everyone who shares the cost must accept it.
 */
export function AgreementForm({ locale, currency, copy, members, names, parent, first, nextVersion, today, initial }: Props) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [review, setReview] = useState<readonly AgreementChange[] | null>(null);
  const [proposed, setProposed] = useState(false);
  const { send, pending, error } = useAgreementRequest();
  const router = useRouter();
  const format = formatters(locale, currency);
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    setReview(null);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = { draft: draftRequest(draft, members.map((member) => member.id)) };
    if (review === null) {
      const reply = await send({ operation: "review", ...request });
      if (reply.ok) setReview(reply.changes ?? []);
      return;
    }
    const reply = await send({ operation: "propose", ...request });
    if (reply.ok) {
      setProposed(true);
      setReview(null);
      router.refresh();
    }
  }

  return (
    <Panel title={first ? copy.form.writeTitle : copy.form.changeTitle} description={copy.form.text}>
      <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
        <fieldset disabled={pending || review !== null} className="min-w-0 space-y-6">
          <ShareFields copy={copy.form} members={members} shares={draft.shares} onChange={(memberId, percent) => edit({ shares: { ...draft.shares, [memberId]: percent } })} />
          <TermFields copy={copy.form} draft={draft} parent={parent} currency={currency} today={today} onChange={edit} />
        </fieldset>
        {review !== null ? (
          <div className="rounded-xl border bg-secondary/40 p-4">
            <ChangeList title={copy.changesTitle} empty={copy.noChanges} changes={review.map((change) => changeWords(copy, (id) => names[id] ?? id, format, parent, change))} />
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error] ?? copy.errors.unavailable}</p> : null}
        {proposed ? <p role="status" className="text-sm text-positive">{copy.form.proposed}</p> : null}
        <div className="flex flex-wrap gap-3">
          {review !== null ? (
            <Button type="button" variant="outline" disabled={pending} className="min-h-11" onClick={() => setReview(null)}>
              {copy.form.edit}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? copy.form.proposing : review === null ? copy.form.review : fill(copy.form.propose, { version: String(nextVersion) })}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
