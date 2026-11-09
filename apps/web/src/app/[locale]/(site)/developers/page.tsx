import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES, MCP_SUPPORTED_VERSIONS } from "@kin/agent";
import type { Metadata } from "next";

import { ContentSection } from "@/components/pages/content-section";
import { PageHero } from "@/components/pages/page-hero";
import { ToolCatalogue } from "@/components/developers/tool-catalogue";
import { CopyBlock } from "@/components/shared/copy-block";
import { ClosingBand } from "@/components/shared/closing-band";
import { StatusNote } from "@/components/shared/status-note";
import { claudeCodeCommand, curlToolsList, curlVisit, mcpJsonConfig } from "@/content/open-kin/connect-snippets";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { fill } from "@/i18n/template";
import { authConfig } from "@/server/auth/config";
import { MCP_PATH } from "@/server/open-kin/mcp";

// The commands name this deployment's own address, read when the page is served, never at build time.
export const dynamic = "force-dynamic";

const TOKEN = "<your-delegation-token>";

export function generateMetadata({ params }: PageProps<"/[locale]/developers">): Promise<Metadata> {
  return pageMetadata(params, "developers");
}

export default async function DevelopersPage({ params }: PageProps<"/[locale]/developers">) {
  const { locale, dictionary } = await pageContext(params);
  const copy = dictionary.developers;
  const tokenCopy = dictionary.openKin.token;
  const labels = { copyLabel: tokenCopy.copy, copiedLabel: tokenCopy.copied, failedLabel: tokenCopy.failed };
  const origin = authConfig().webOrigin;
  const endpoint = `${origin}${MCP_PATH}`;
  const tools = ASK_KIN_TOOL_NAMES.map((name) => ({ name, kind: ASK_KIN_TOOLS[name].kind, description: ASK_KIN_TOOLS[name].description }));

  return (
    <>
      <PageHero eyebrow={copy.hero.eyebrow} title={copy.hero.title} lede={copy.hero.lede} />
      <ContentSection id="mcp" eyebrow={copy.mcp.eyebrow} title={copy.mcp.title} lede={fill(copy.mcp.lede, { versions: MCP_SUPPORTED_VERSIONS.join(", ") })}>
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="grid min-w-0 content-start gap-5">
            <CopyBlock label={copy.mcp.endpoint} value={endpoint} {...labels} />
            <CopyBlock label={copy.mcp.claudeCode} value={claudeCodeCommand(endpoint, TOKEN)} {...labels} />
            <CopyBlock label={copy.mcp.config} value={mcpJsonConfig(endpoint, TOKEN)} {...labels} />
            <CopyBlock label={copy.mcp.curl} value={curlToolsList(endpoint, TOKEN)} {...labels} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{copy.mcp.tools}</h3>
            <p className="mt-1 text-muted-foreground">{copy.mcp.toolsLede}</p>
            <ToolCatalogue tools={tools} kinds={copy.mcp.kinds} />
          </div>
        </div>
      </ContentSection>
      <ContentSection id="boundary" tone="muted" eyebrow={copy.boundary.eyebrow} title={copy.boundary.title}>
        <ul className="grid max-w-3xl gap-3">
          {copy.boundary.items.map((item) => (
            <li key={item} className="flex min-w-0 gap-3 rounded-2xl border bg-card p-4 text-pretty">
              <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-highlight" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      </ContentSection>
      <ContentSection id="agency" eyebrow={copy.agency.eyebrow} title={copy.agency.title} lede={copy.agency.lede}>
        <div className="grid min-w-0 gap-5 lg:max-w-4xl">
          <CopyBlock label={copy.agency.sign} value={curlVisit(origin, "agk_…", "kin_ags_…", dictionary.dashboard.common.roles.caregiver)} {...labels} />
          <p className="text-sm text-muted-foreground">{copy.agency.responses}</p>
        </div>
      </ContentSection>
      <ContentSection id="openapi" tone="muted" eyebrow={copy.openapi.eyebrow} title={copy.openapi.title} lede={copy.openapi.lede}>
        {/* A JSON document, not a page: a plain link, so the browser opens it. */}
        <a href="/api/v1/openapi.json" className="inline-flex min-h-11 items-center font-medium">
          <span className="border-b border-current pb-0.5">{copy.openapi.link}</span>
        </a>
      </ContentSection>
      <ContentSection id="next" eyebrow={copy.next.eyebrow} title={copy.next.title}>
        <div className="grid max-w-3xl gap-3">
          {copy.next.items.map((item) => (
            <StatusNote key={item} title={copy.next.eyebrow} text={item} />
          ))}
        </div>
      </ContentSection>
      <ClosingBand locale={locale} title={dictionary.home.closing.title} nav={dictionary.common.nav} />
    </>
  );
}
