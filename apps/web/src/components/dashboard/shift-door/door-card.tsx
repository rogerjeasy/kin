import { QrSvg } from "@/components/dashboard/shift-links/qr-svg";
import type { Dictionary } from "@/i18n/dictionary";
import type { QrCode } from "@/server/qr-code";

type Props = { copy: Dictionary["dashboard"]["shiftDoor"]; code: QrCode; address: string };

/**
 * The card to print and put by the door: a code that opens the caregiver's own
 * shifts, and the same address as text for writing onto an NFC tag. Nothing
 * secret and no money or name is on it, because a visitor can read a door. On
 * paper it is black on white whatever the theme, and fills one page.
 */
export function DoorCard({ copy, code, address }: Props) {
  return (
    <article aria-labelledby="door-card-title" className="surface relative mx-auto flex w-full min-w-0 max-w-xl flex-col items-center gap-6 overflow-clip rounded-[2rem] p-6 text-center shadow-xl sm:p-10 print:max-w-none print:border-0 print:bg-white print:p-0 print:text-black print:shadow-none">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-gold print:hidden" />
      <h2 id="door-card-title" className="font-serif text-3xl leading-tight text-balance sm:text-4xl print:text-5xl">
        {copy.cardTitle}
      </h2>
      <div className="w-full max-w-sm rounded-[1.75rem] bg-white p-3 shadow-[0_0_0_1px_var(--border),0_24px_60px_-24px_rgb(var(--glow-gold)/0.7)] print:max-w-md print:p-0 print:shadow-none">
        <QrSvg code={code} label={copy.qrLabel} className="rounded-2xl" />
      </div>
      <p className="text-lg text-pretty print:text-2xl">{copy.scan}</p>
      <div className="w-full min-w-0 space-y-2">
        <p className="text-base font-medium print:text-xl">{copy.addressLabel}</p>
        {/* An address reads left to right in every language, and wraps anywhere rather than spilling out. */}
        <p dir="ltr" className="rounded-2xl border border-dashed bg-muted/60 px-4 py-3 wrap-anywhere font-mono text-base print:border-0 print:bg-white print:p-0 print:text-xl">{address}</p>
      </div>
      <p className="text-sm text-pretty print:hidden">{copy.nfc}</p>
      <p className="text-sm text-pretty print:text-base">{copy.noSecret}</p>
    </article>
  );
}
