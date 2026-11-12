import { TriangleAlertIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import type { OAuthClient } from "@/server/open-kin/oauth-clients";

type Props = { copy: Dictionary["openKin"]["oauth"]; client: OAuthClient; redirectUri: string; circleName: string; seat: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** One fact of the request: a term and its value, which may be long and always wraps. */
function Fact({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className={mono ? "font-mono text-sm font-semibold break-all" : "font-semibold break-words"} dir={mono ? "ltr" : "auto"}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Who is asking and where the answer goes. The name is the client's own
 * claim; the host the code is sent to is what the member can check, so it is
 * shown plainly, with a warning when it is this computer (the MCP
 * specification asks for both).
 */
export function OAuthClientPanel({ copy, client, redirectUri, circleName, seat }: Props) {
  const target = new URL(redirectUri);
  const local = LOOPBACK.has(target.hostname);
  return (
    <Panel title={copy.who} description={copy.selfNamed}>
      <dl className="grid min-w-0 gap-4">
        <Fact term={copy.name} value={client.name ?? copy.unnamed} />
        <Fact term={copy.sendsTo} value={target.host} mono />
        {client.documentHost === null ? null : <Fact term={copy.publishedBy} value={client.documentHost} mono />}
        <Fact term={copy.circle} value={circleName} />
        <Fact term={copy.seat} value={seat} />
      </dl>
      {local ? (
        <p className="mt-4 flex min-w-0 items-start gap-2.5 rounded-2xl border border-danger/40 bg-danger/5 p-3 text-sm text-pretty">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <span className="min-w-0">{copy.localWarning}</span>
        </p>
      ) : null}
    </Panel>
  );
}
