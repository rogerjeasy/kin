"use client";

import { PlayIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { ConsoleStep, type StepState } from "./console-step";
import { consoleToken, rpc, type Exchange, type RpcReply } from "./mcp-console-client";

type Props = {
  copy: Dictionary["openKin"]["console"];
  /** The endpoint, as an outside client would be given it. */
  endpoint: string;
  /** Who the session plays as: the seat the viewer holds. */
  seatName: string;
  /** A payment that waits for a yes, which the assistant tries to approve, if there is one. */
  waitingProposalId: string | null;
};

const STEPS = ["connect", "list", "ask", "approve"] as const;
type StepKey = (typeof STEPS)[number];
type Step = { readonly state: StepState; readonly exchanges: readonly Exchange[]; readonly detail: string | null; readonly quote: string | null };

const fresh = (): Record<StepKey, Step> => Object.fromEntries(STEPS.map((key) => [key, { state: "waiting", exchanges: [], detail: null, quote: null }])) as unknown as Record<StepKey, Step>;

/** The summary sentence a tool result carries, from the record. */
function summaryOf(reply: RpcReply): string | null {
  const structured = reply.result?.["structuredContent"];
  if (typeof structured !== "object" || structured === null || !("summary" in structured)) return null;
  return typeof structured.summary === "string" ? structured.summary : null;
}

/**
 * Plays a real MCP session against Kin's own endpoint, from the browser, the
 * way an outside assistant connects: discover, list the tools, ask what the
 * member owes, then try to approve, and show Kin's refusal. The token is a
 * fifteen-minute one Kin issues for the viewer's seat, in a demo circle only.
 */
export function LiveConsole({ copy, endpoint, seatName, waitingProposalId }: Props) {
  const router = useRouter();
  const [steps, setSteps] = useState(fresh);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [failed, setFailed] = useState(false);

  const update = (key: StepKey, step: Partial<Step>) => setSteps((current) => ({ ...current, [key]: { ...current[key], ...step } }));

  async function play() {
    setPlaying(true);
    setFailed(false);
    setSteps(fresh());
    try {
      const session = await consoleToken();
      if (session === null) throw new Error("no console token");
      const call = (id: number, method: string, params?: Record<string, unknown>) => rpc("/api/mcp", session.token, id, method, params);

      update("connect", { state: "running" });
      const discovered = await call(1, "server/discover");
      const versions = discovered.result?.["supportedVersions"];
      update("connect", { state: discovered.result ? "done" : "failed", exchanges: [discovered.exchange], detail: discovered.result ? fill(copy.steps.connect.done, { version: Array.isArray(versions) ? String(versions[0]) : "" }) : null });
      if (!discovered.result) throw new Error("discover failed");

      update("list", { state: "running" });
      const listed = await call(2, "tools/list");
      const tools = Array.isArray(listed.result?.["tools"]) ? listed.result["tools"] : [];
      update("list", { state: listed.result ? "done" : "failed", exchanges: [listed.exchange], detail: fill(copy.steps.list.done, { count: String(tools.length) }) });

      update("ask", { state: "running" });
      const owed = await call(3, "tools/call", { name: "get_fairness", arguments: {} });
      update("ask", { state: owed.result && owed.result["isError"] !== true ? "done" : "failed", exchanges: [owed.exchange], detail: copy.steps.ask.done, quote: summaryOf(owed) });

      update("approve", { state: "running" });
      const approve = await call(4, "tools/call", { name: "approve_proposal", arguments: waitingProposalId === null ? {} : { proposalId: waitingProposalId } });
      update("approve", { state: approve.error ? "refused" : "failed", exchanges: [approve.exchange], detail: approve.error ? fill(copy.steps.approve.done, { code: String(approve.error.code) }) : null });
      setPlayed(true);
      router.refresh();
    } catch {
      setFailed(true);
      setSteps((current) => Object.fromEntries(STEPS.map((key) => [key, current[key].state === "running" ? { ...current[key], state: "failed" } : current[key]])) as unknown as Record<StepKey, Step>);
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void play()} disabled={playing} className="h-auto min-h-12 max-w-full whitespace-normal text-start">
          {played ? <RotateCcwIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
          {playing ? copy.playing : played ? copy.again : copy.play}
        </Button>
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">{fill(copy.seat, { name: seatName })}</p>
      </div>
      <p className="min-w-0 text-sm">
        <span className="font-semibold">{copy.endpoint}: </span>
        <code dir="ltr" className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs wrap-anywhere">
          {endpoint}
        </code>
      </p>
      <ol aria-live="polite" aria-busy={playing} className="grid min-w-0 gap-3">
        {STEPS.map((key, index) => {
          const step = steps[key];
          return (
            <ConsoleStep key={key} index={index + 1} title={copy.steps[key].title} state={step.state} copy={copy} exchanges={step.exchanges}>
              {step.detail ? <p>{step.detail}</p> : null}
              {step.quote ? <blockquote className="mt-2 rounded-lg border-s-4 border-s-positive bg-positive/5 p-3 text-pretty">{step.quote}</blockquote> : null}
            </ConsoleStep>
          );
        })}
      </ol>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {copy.error}
        </p>
      ) : null}
      {played && !playing ? (
        <p role="status" className="text-sm font-medium">
          {copy.refreshed}
        </p>
      ) : null}
    </div>
  );
}
