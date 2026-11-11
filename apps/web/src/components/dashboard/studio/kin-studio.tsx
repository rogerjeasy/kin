"use client";

import { AgStudioAiModule } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo } from "react";

import type { StudioData } from "@/content/circle/studio-data";
import type { Locale } from "@/i18n/locales";
import { formatters } from "@/lib/format";

import { kinStudioAdapter } from "./studio-adapter";
import { kinStudioAgents } from "./studio-agents";
import type { StudioContext } from "./studio-context";
import { studioReport } from "./studio-report";
import { studioSources, type StudioCopy } from "./studio-sources";
import { kinStudioTheme } from "./studio-theme";
import { kinWidgets, type KinRegistry } from "./studio-widgets";

/** What the page hands the studio's agents: Kin's prompts from packages/agent, and the record's figures already written for people. */
export type StudioAgentProps = {
  readonly instructions: string;
  readonly toolName: string;
  readonly toolDescription: string;
  readonly kinDescription: string;
  readonly leadNote: string;
  readonly facts: readonly string[];
};

export type KinStudioProps = {
  readonly data: StudioData;
  readonly copy: StudioCopy;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly rtl: boolean;
  /** An observer may only look. */
  readonly readOnly: boolean;
  /** The licence key, when one was built in; AG Studio runs unlicensed, with its watermark, without one. */
  readonly licenseKey: string | undefined;
  /** Kin's agents, or `null` when this deployment has no model or the licence does not cover AI. */
  readonly agents: StudioAgentProps | null;
};

/** AG Studio, holding the circle's record, in Kin's theme, with Kin's widgets and Kin's agent beside AG Studio's own. */
export default function KinStudio({ data, copy, locale, timeZone, rtl, readOnly, licenseKey, agents }: KinStudioProps) {
  const format = useMemo(() => formatters(locale, data.currency, timeZone), [locale, data.currency, timeZone]);
  const sources = useMemo(() => studioSources(data, copy, format), [data, copy, format]);
  const report = useMemo(() => studioReport(copy), [copy]);
  const widgets = useMemo(() => kinWidgets(copy), [copy]);
  const context = useMemo<StudioContext>(() => ({ copy, format }), [copy, format]);
  const ai = useMemo(() => {
    if (agents === null) return undefined;
    const adapter = kinStudioAdapter({ locale, failed: copy.assistant.failed });
    const { starters } = copy.assistant;
    return kinStudioAgents({
      adapter,
      ...agents,
      readOnly,
      starters: [starters.caregiverPay, starters.fairness, starters.fees],
    });
  }, [agents, copy, locale, readOnly]);

  return (
    <AgStudioProvider modules={agents === null ? [] : [AgStudioAiModule]} {...(licenseKey ? { licenseKey } : {})}>
      <AgStudio<KinRegistry>
        className="h-full w-full"
        data={sources}
        mode={readOnly ? "view" : "edit"}
        initialState={report}
        widgets={widgets}
        theme={kinStudioTheme}
        context={context}
        enableRtl={rtl}
        {...(ai ? { ai } : {})}
      />
    </AgStudioProvider>
  );
}
