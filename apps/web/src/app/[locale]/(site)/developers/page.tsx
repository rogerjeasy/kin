import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES, MCP_SUPPORTED_VERSIONS } from "@kin/agent";
import type { Metadata } from "next";

import { ContentSection } from "@/components/pages/content-section";
import { PageHero } from "@/components/pages/page-hero";
import { ToolCatalogue } from "@/components/developers/tool-catalogue";
import { CopyBlock } from "@/components/shared/copy-block";
import { ClosingBand } from "@/components/shared/closing-band";
import { StatusNote } from "@/components/shared/status-note";
import { claudeCodeCommand, curlInvoice, curlInvoiceStatus, curlToolsList, curlVisit, mcpJsonConfig } from "@/content/open-kin/connect-snippets";
import { pageContext, pageMetadata } from "@/i18n/page-context";
import { fill } from "@/i18n/template";
import { authConfig } from "@/server/auth/config";
import { MCP_PATH } from "@/server/open-kin/mcp";

/** The SDKs APIMatic generates from the OpenAPI document (pnpm --filter @kin/web run sdk:generate), in the public repository. */
const SDK_LINKS = {
  typescript: "https://github.com/rogerjeasy/kin/tree/main/sdks/typescript",
  python: "https://github.com/rogerjeasy/kin/tree/main/sdks/python",
} as const;

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
      <ContentSection id="invoices" tone="muted" eyebrow={copy.agency.eyebrow} title={copy.agency.invoiceTitle} lede={copy.agency.invoiceLede}>
        <div className="grid min-w-0 gap-5 lg:max-w-4xl">
          <CopyBlock label={copy.agency.invoiceSign} value={curlInvoice(origin, "agk_…", "kin_ags_…")} {...labels} />
          <CopyBlock label={copy.agency.statusSign} value={curlInvoiceStatus(origin, "agk_…", "kin_ags_…")} {...labels} />
          <p className="text-sm text-muted-foreground">{copy.agency.invoiceResponses}</p>
        </div>
      </ContentSection>
      <ContentSection id="openapi" eyebrow={copy.openapi.eyebrow} title={copy.openapi.title} lede={copy.openapi.lede}>
        {/* A JSON document, not a page: a plain link, so the browser opens it. */}
        <a href="/api/v1/openapi.json" className="inline-flex min-h-11 items-center font-medium">
          <span className="border-b border-current pb-0.5">{copy.openapi.link}</span>
        </a>
        <p className="mt-6 max-w-3xl text-pretty text-muted-foreground">{copy.openapi.sdks}</p>
        <div className="mt-2 flex flex-wrap gap-x-6">
          {[
            { href: SDK_LINKS.typescript, label: copy.openapi.typescript },
            { href: SDK_LINKS.python, label: copy.openapi.python },
          ].map((link) => (
            <a key={link.href} href={link.href} className="inline-flex min-h-11 items-center font-medium">
              <span className="border-b border-current pb-0.5">{link.label}</span>
            </a>
          ))}
        </div>
      </ContentSection>
      {copy.next.items.length > 0 ? (
        <ContentSection id="next" tone="muted" eyebrow={copy.next.eyebrow} title={copy.next.title}>
          <div className="grid max-w-3xl gap-3">
            {copy.next.items.map((item) => (
              <StatusNote key={item} title={copy.next.eyebrow} text={item} />
            ))}
          </div>
        </ContentSection>
      ) : null}
      <ClosingBand locale={locale} title={dictionary.home.closing.title} nav={dictionary.common.nav} />
    </>
  );
}
