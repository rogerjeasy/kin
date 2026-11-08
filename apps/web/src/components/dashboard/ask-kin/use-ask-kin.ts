"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { Locale } from "@/i18n/locales";
import type { AskKinResponse } from "@/server/ask-kin/ask-kin";

export type AskKinAnswer = Extract<AskKinResponse, { ok: true }>;
export type AskKinFailure = Extract<AskKinResponse, { ok: false }>["reason"];

export type AskKinState =
  | { readonly status: "idle" }
  | { readonly status: "asking"; readonly question: string }
  | { readonly status: "failed"; readonly question: string; readonly reason: AskKinFailure }
  | { readonly status: "answered"; readonly question: string; readonly answer: AskKinAnswer };

/** The browser keeps the conversation; the server keeps none. Never more than the server accepts. */
const HISTORY = 6;

const REASONS: readonly AskKinFailure[] = ["refused", "invalid", "busy", "unavailable"];

/**
 * Asks Kin one question at a time and keeps the last few turns to send with
 * the next, so a follow-up question has its context. A raised proposal
 * refreshes the screens, so the approvals badge shows it.
 */
export function useAskKin(locale: Locale) {
  const [state, setState] = useState<AskKinState>({ status: "idle" });
  const history = useRef<{ question: string; answer: string }[]>([]);
  const router = useRouter();

  async function ask(question: string) {
    setState({ status: "asking", question });
    try {
      const response = await fetch("/api/ask-kin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, locale, history: history.current }),
      });
      const body = (await response.json().catch(() => null)) as AskKinResponse | null;
      if (body?.ok === true) {
        history.current = [...history.current, { question, answer: body.answer }].slice(-HISTORY);
        setState({ status: "answered", question, answer: body });
        if (body.proposal !== null) router.refresh();
        return;
      }
      const reason = REASONS.find((each) => each === body?.reason) ?? "unavailable";
      setState({ status: "failed", question, reason });
    } catch {
      setState({ status: "failed", question, reason: "unavailable" });
    }
  }

  return { state, ask };
}
