import { XIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { setDemoGuide } from "@/server/demo-actions";

import { DemoGuideFrame } from "./demo-guide-frame";
import { DemoGuideStep } from "./demo-guide-step";
import type { DemoGuideView } from "./shell-context";

type Props = { locale: Locale; guide: DemoGuideView; copy: Dictionary["dashboard"]["shell"]["demo"]["guide"] };

/**
 * The judge's path through the demo, under the demo banner: a few steps, each
 * one press away, each saying what is real behind it. A visitor can put it
 * away; the banner then offers it again.
 */
export function DemoGuide({ locale, guide, copy }: Props) {
  const titleId = useId();
  if (guide.hidden) return null;
  return (
    <DemoGuideFrame
      titleId={titleId}
      title={guide.title}
      toggle={{ show: copy.show, hide: copy.hide }}
      dismiss={
        <form action={setDemoGuide}>
          <input type="hidden" name="guide" value="hide" />
          <Button type="submit" variant="ghost" size="icon" aria-label={copy.dismiss} title={copy.dismiss}>
            <XIcon />
          </Button>
        </form>
      }
    >
      {guide.steps.map((step) => (
        <li key={step.key} className="min-w-0">
          <DemoGuideStep locale={locale} step={step} />
        </li>
      ))}
    </DemoGuideFrame>
  );
}
