"use client";

import { LinkIcon } from "lucide-react";
import { useId, useState } from "react";

import { useShiftRequest } from "@/components/dashboard/shifts/use-shift-request";
import { Button } from "@/components/ui/button";
import { failureText, type ShiftCopy } from "@/content/circle/shift-words";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { MadeLink } from "@/server/shift-links";

import { LinkResult } from "./link-result";
import { TextLinkForm } from "./text-link-form";

type Props = {
  shiftId: string;
  /** The caregiver's first name, from the record. */
  name: string;
  locale: Locale;
  timezone: string;
  copy: Dictionary["dashboard"]["shiftLinks"];
  shifts: ShiftCopy;
  /** Whether this deployment can send texts. */
  textingOn: boolean;
};

/**
 * A shift's check-in link, on its card: make one, copy it, show it as a QR
 * code, or text it. The link is shown once and held only in this panel's
 * memory; closing the panel forgets it.
 */
export function ShiftLinkPanel({ shiftId, name, locale, timezone, copy, shifts, textingOn }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<MadeLink | null>(null);
  const { send, pending, error } = useShiftRequest();

  async function make() {
    const reply = await send({ operation: "check_link", shiftId, locale });
    if (reply.ok && "link" in reply) setLink(reply.link);
  }

  function toggle() {
    if (open) setLink(null);
    setOpen(!open);
  }

  return (
    <div className="min-w-0 space-y-3">
      <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        <LinkIcon aria-hidden="true" />
        {open ? copy.close : copy.open}
      </Button>
      {open ? (
        <div id={panelId} role="group" aria-label={fill(copy.title, { name })} className="min-w-0 space-y-5 rounded-xl border bg-secondary/40 p-4 sm:p-5">
          <div className="min-w-0 space-y-1">
            <h3 className="font-semibold text-pretty">{fill(copy.title, { name })}</h3>
            <p className="text-sm text-muted-foreground text-pretty">{fill(copy.text, { name })}</p>
          </div>
          {link === null ? (
            <Button type="button" disabled={pending} onClick={make}>
              {pending ? copy.making : copy.make}
            </Button>
          ) : (
            <LinkResult link={link} copy={copy} name={name} locale={locale} timezone={timezone} />
          )}
          {error ? <p role="alert" className="text-sm text-danger">{failureText(shifts, error)}</p> : null}
          {textingOn ? <TextLinkForm shiftId={shiftId} locale={locale} copy={copy} shifts={shifts} idPrefix={panelId} onMade={setLink} /> : <p className="text-sm text-muted-foreground text-pretty">{copy.textingOff}</p>}
        </div>
      ) : null}
    </div>
  );
}
