import { MAX_QUESTION_LENGTH } from "@kin/agent";
import type { Metadata } from "next";

import { AskKinPanel } from "@/components/dashboard/ask-kin/ask-kin-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { askKinSuggestions } from "@/content/circle/ask-kin-suggestions";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { routes } from "@/content/site-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { questionAllowanceFor, questionsLeft } from "@/server/ask-kin/demo-questions";
import { dashboardContext } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/ask">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, lede } = dictionary.askKin;
  return { title, description: lede, robots: { index: false, follow: false } };
}

export default async function AskKinPage({ params, searchParams }: PageProps<"/[locale]/dashboard/ask">) {
  // Anyone seated in the circle may ask: the circle screen's access rule. The tools the model is offered follow the role.
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "circle");
  const copy = dictionary.askKin;
  const { q } = await searchParams;
  const carried = typeof q === "string" ? q.slice(0, MAX_QUESTION_LENGTH) : "";
  const suggestions = askKinSuggestions(circle, copy.suggestions, circleFormatters(locale, circle), circleNames(circle, dictionary));
  // A demo visitor who has not signed in has a few questions; the server counts them, this only shows what is left.
  const allowance = await questionAllowanceFor(viewer);
  const left = questionsLeft(allowance, viewer.userId, Date.now());
  const { nav } = dictionary.common;

  return (
    <>
      <PageHeader title={copy.title} lede={copy.lede} />
      <AskKinPanel
        locale={locale}
        copy={copy}
        suggestions={suggestions}
        initialQuestion={carried}
        maxLength={MAX_QUESTION_LENGTH}
        demoQuestions={allowance === undefined || left === null ? null : { total: allowance.limit, left }}
        links={{ signUp: { href: localizedPath(locale, routes.start), label: copy.demoLimit.signUp }, signIn: { href: localizedPath(locale, routes.signIn), label: nav.signIn } }}
      />
    </>
  );
}
