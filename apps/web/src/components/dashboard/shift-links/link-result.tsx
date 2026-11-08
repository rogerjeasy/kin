import type { Locale } from "@/i18n/locales";
import { numberLocaleOf } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import type { Dictionary } from "@/i18n/dictionary";
import type { MadeLink } from "@/server/shift-links";

import { CopyField } from "./copy-field";
import { QrSvg } from "./qr-svg";

type Props = { link: MadeLink; copy: Dictionary["dashboard"]["shiftLinks"]; name: string; locale: Locale; timezone: string };

/** The link just made: the address to copy, the same address as a QR code, and when it stops working. */
export function LinkResult({ link, copy, name, locale, timezone }: Props) {
  const until = new Intl.DateTimeFormat(numberLocaleOf(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(link.expiresAt));
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0 space-y-3">
        <CopyField label={copy.linkLabel} value={link.url} copyLabel={copy.copy} copiedLabel={copy.copied} failedLabel={copy.copyFailed} />
        <p className="text-sm text-muted-foreground">{fill(copy.expires, { time: until })}</p>
        <p className="text-sm text-muted-foreground">{copy.once}</p>
      </div>
      <figure className="min-w-0 space-y-2 sm:w-44">
        <QrSvg code={link.qr} label={copy.qrLabel} className="mx-auto max-w-44" />
        <figcaption className="text-sm text-muted-foreground text-pretty">{fill(copy.qrText, { name })}</figcaption>
      </figure>
    </div>
  );
}
