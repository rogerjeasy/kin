"use client";

import { ShieldQuestionIcon, UserRoundIcon, UserRoundXIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { KinThinking } from "@/components/dashboard/ai/kin-thinking";
import { inputClass } from "@/components/dashboard/create-circle/field";
import { postLetterJson, type LetterError } from "@/components/dashboard/letters/letter-client";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { localizedPath } from "@/i18n/routing";
import { formatters } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CheckView, OpenedCheck } from "@/server/presence";

import { CheckActions } from "./check-actions";
import { CheckResult } from "./check-result";
import { FamilyPhone } from "./family-phone";

type Props = { locale: Locale; copy: Dictionary["dashboard"]["presence"]; /** The circle's currency and time zone: the form writes amounts and times itself, since functions cannot cross from the server. */ currency: string; timezone: string };
type Opened = Extract<OpenedCheck, { ok: true }>;

const EXAMPLES = ["grandson", "stranger"] as const;
const EXAMPLE_ICON = { grandson: UserRoundIcon, stranger: UserRoundXIcon } as const;
const POLL_MS = 2_000;
/** A check is open only while Kin waits for the real person, so the screen stops asking once it has ended. */
const isOpen = (check: CheckView): boolean => check.state === "opened" || check.state === "asked";
const tokenOf = (link: string): string => link.slice(link.lastIndexOf("/") + 1);

/**
 * "Is this real?": the parent, or a member for them, says what the caller said.
 * The server reads it, asks the real person and answers with one fixed
 * sentence; this screen only carries words and then looks at the check every
 * couple of seconds until it ends. In a demo circle it shows the real person's
 * phone beside it, so the whole moment can be watched on one screen.
 */
export function CheckForm({ locale, copy, currency, timezone }: Props) {
  const format = formatters(locale, currency, timezone);
  const id = useId();
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [check, setCheck] = useState<CheckView | null>(null);
  const checkId = useRef<string | null>(null);

  const look = useCallback(async () => {
    if (checkId.current === null) return;
    const reply = await postLetterJson<{ ok: true; check: CheckView }>("/api/presence/status", { id: checkId.current, locale });
    if (reply.ok) {
      setCheck(reply.check);
      if (!isOpen(reply.check)) router.refresh();
    }
  }, [locale, router]);

  useEffect(() => {
    if (check === null || !isOpen(check)) return;
    const timer = setInterval(() => void look(), POLL_MS);
    return () => clearInterval(timer);
  }, [check, look]);

  async function ask() {
    setPending(true);
    setError(null);
    setOpened(null);
    setCheck(null);
    const reply = await postLetterJson<Opened>("/api/presence", { locale, account });
    setPending(false);
    if (reply.ok) {
      checkId.current = reply.check.id;
      setOpened(reply);
      setCheck(reply.check);
      router.refresh();
    } else setError((reply as LetterError).reason);
  }

  return (
    <Panel title={copy.askTitle} description={copy.askText}>
      <form
        className="min-w-0 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <fieldset className="min-w-0 space-y-2">
          <legend className="font-medium">{copy.examplesLabel}</legend>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            {EXAMPLES.map((key) => {
              const Icon = EXAMPLE_ICON[key];
              const chosen = account === copy.examples[key].text;
              return (
                <Button key={key} type="button" variant="outline" disabled={pending} onClick={() => setAccount(copy.examples[key].text)} className={cn("lift h-auto min-h-14 max-w-full justify-start rounded-2xl px-4 py-3 whitespace-normal text-start", chosen && "border-gold/70 bg-highlight/10 shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.15)]")}>
                  <span aria-hidden="true" className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-1", chosen ? "bg-gold/25 text-highlight ring-gold/50" : "bg-secondary text-muted-foreground ring-border")}>
                    <Icon className="size-4.5" />
                  </span>
                  <span className="min-w-0">{copy.examples[key].label}</span>
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-account`} className="font-medium">{copy.accountLabel}</label>
          <p id={`${id}-account-hint`} className="text-sm text-muted-foreground">{copy.accountHint}</p>
          <textarea id={`${id}-account`} aria-describedby={`${id}-account-hint`} dir="auto" rows={5} required maxLength={1200} value={account} disabled={pending} onChange={(event) => setAccount(event.target.value)} className={`${inputClass} min-h-36 py-3 text-lg leading-relaxed`} />
        </div>
        <Button type="submit" disabled={pending || account.trim() === ""} className="h-auto min-h-14 max-w-full px-7 whitespace-normal text-start text-lg">
          <ShieldQuestionIcon aria-hidden="true" className="size-6" />
          {pending ? copy.submitting : copy.submit}
        </Button>
        {pending ? <KinThinking label={copy.submitting} /> : null}
        {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof typeof copy.errors] ?? copy.errors.unavailable}</p> : null}
      </form>
      {check ? (
        <div className="mt-6 grid min-w-0 items-start gap-6 border-t border-dashed pt-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="min-w-0 space-y-4">
            <CheckResult check={check} copy={copy} format={format} />
            <CheckActions check={check} locale={locale} copy={copy} max={check.helpMaxCents === null ? null : format.money(check.helpMaxCents)} approvalsHref={localizedPath(locale, dashboardRoutes.approvals)} />
          </div>
          {opened?.phone && isOpen(check) ? <FamilyPhone copy={copy} phone={opened.phone} token={tokenOf(opened.phone.link)} /> : null}
        </div>
      ) : null}
    </Panel>
  );
}
