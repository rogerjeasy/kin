import Image from "next/image";

import rosePortrait from "@/assets/images/rose-portrait.jpg";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

import { SpokenCaption } from "./spoken-caption";

type PortraitCardProps = {
  locale: Locale;
  copy: Dictionary["home"]["hero"];
  /** The formatted amount above which Rose must say yes. */
  limit: string;
};

/**
 * Rose's photograph with what Kin told her. From sm up the note and the caption
 * sit over the photograph, stacked in one grid cell. On a phone the caption
 * drops below, so it never covers her face.
 */
export function PortraitCard({ locale, copy, limit }: PortraitCardProps) {
  return (
    <div className="grid grid-cols-1">
      <Image
        src={rosePortrait}
        alt={copy.portraitAlt}
        priority
        placeholder="blur"
        sizes="(min-width: 1024px) 40rem, 100vw"
        className="col-start-1 row-start-1 aspect-square w-full rounded-3xl object-cover object-[50%_15%] sm:aspect-4/5 sm:max-h-160"
      />
      <p className="col-start-1 row-start-1 m-4 hidden max-w-xs self-start justify-self-start rounded-xl bg-card px-3.5 py-2.5 text-sm sm:block">
        <strong className="block font-semibold">{copy.pinTitle}</strong>
        <span className="text-muted-foreground">{fill(copy.pinNote, { limit })}</span>
      </p>
      <SpokenCaption
        locale={locale}
        copy={copy}
        className="col-start-1 row-start-2 mt-3 border sm:row-start-1 sm:m-4 sm:mt-0 sm:self-end sm:border-0"
      />
    </div>
  );
}
