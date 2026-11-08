import type { CircleSnapshot } from "@kin/db";

import { Panel } from "@/components/dashboard/ui/panel";
import type { CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import { may } from "@/server/dashboard-context";
import { mayEnableCall } from "@/server/shift-call-settings";

import { CallSettingsForm, type CallSettingsState } from "./call-settings-form";

type Props = { circle: CircleSnapshot; dictionary: Dictionary; names: CircleNames; format: Formatters };

/** "21:00:00" as "21:00": the quiet hours are times of day on the circle's own clock. */
const clockText = (time: string): string => time.slice(0, 5);

/** The parent's phone call settings: shown to those who may stop the call, and with the form to start it only to those who may start it. */
export function CallSettingsSection({ circle, dictionary, names, format }: Props) {
  if (!may(circle, "shift_call.stop")) return null;
  const copy = dictionary.dashboard.shiftCalls.settings;
  const settings = circle.parentCallSettings;
  const canEnable = mayEnableCall(circle);
  // A contributor may stop the call but is not shown its settings, so for them its state is not known.
  const state: CallSettingsState = settings === null ? (canEnable ? "not_set" : "unknown") : settings.enabled ? "on" : "off";
  const consent = settings?.consentedBy && settings.consentedAt ? fill(copy.consented, { name: names.member(settings.consentedBy), date: format.longDay(settings.consentedAt) }) : null;
  const quiet = fill(copy.quiet, { start: clockText(settings?.quietStart ?? "21:00:00"), end: clockText(settings?.quietEnd ?? "08:00:00") });

  return (
    <Panel title={copy.title} description={fill(copy.text, { parent: names.parent })}>
      <div className="min-w-0 space-y-4">
        {circle.circle.demo && canEnable && circle.viewer.role !== "parent" ? <p className="text-sm text-muted-foreground text-pretty">{fill(copy.demoNote, { parent: names.parent })}</p> : null}
        <CallSettingsForm copy={copy} shifts={dictionary.dashboard.shifts} state={state} canEnable={canEnable} consentLine={consent} rulesLine={quiet} onlyParentLine={fill(copy.onlyParent, { parent: names.parent })} />
      </div>
    </Panel>
  );
}
