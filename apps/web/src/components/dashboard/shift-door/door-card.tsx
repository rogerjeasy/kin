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
    <article aria-labelledby="door-card-title" className="mx-auto flex w-full min-w-0 max-w-xl flex-col items-center gap-6 rounded-3xl border-2 bg-card p-6 text-center sm:p-10 print:max-w-none print:border-0 print:bg-white print:p-0 print:text-black">
      <h2 id="door-card-title" className="font-serif text-3xl leading-tight text-balance sm:text-4xl print:text-5xl">
        {copy.cardTitle}
      </h2>
      <QrSvg code={code} label={copy.qrLabel} className="max-w-sm print:max-w-md" />
      <p className="text-lg text-pretty print:text-2xl">{copy.scan}</p>
      <div className="w-full min-w-0 space-y-2">
        <p className="text-base font-medium print:text-xl">{copy.addressLabel}</p>
        {/* An address reads left to right in every language, and wraps anywhere rather than spilling out. */}
        <p dir="ltr" className="wrap-anywhere font-mono text-base print:text-xl">{address}</p>
      </div>
      <p className="text-sm text-pretty print:hidden">{copy.nfc}</p>
      <p className="text-sm text-pretty print:text-base">{copy.noSecret}</p>
    </article>
  );
}
