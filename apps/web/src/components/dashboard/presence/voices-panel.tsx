import type { TrustedVoiceRecord } from "@kin/db";

import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { VoiceForm } from "./voice-form";
import { VoiceRow } from "./voice-row";

type Props = {
  locale: Locale;
  voices: readonly TrustedVoiceRecord[];
  copy: Dictionary["dashboard"]["presence"];
  languageNames: Readonly<Record<Locale, string>>;
  /** Whether the viewer may add and remove people: the organizer and the parent. */
  canManage: boolean;
};

/** The people Kin may ask "is it really you?": children and grandchildren who confirmed their own number. They need no Kin account. */
export function VoicesPanel({ locale, voices, copy, languageNames, canManage }: Props) {
  return (
    <Panel title={copy.voices.title} description={copy.voices.text}>
      <div className="min-w-0 space-y-6">
        {voices.length === 0 ? (
          <EmptyState text={copy.voices.empty} />
        ) : (
          <ul className="min-w-0 divide-y">
            {voices.map((voice) => (
              <VoiceRow key={voice.id} voice={voice} copy={copy.voices} canRemove={canManage} />
            ))}
          </ul>
        )}
        {canManage ? <VoiceForm locale={locale} copy={copy.voices} errors={copy.errors} languageNames={languageNames} /> : null}
      </div>
    </Panel>
  );
}
