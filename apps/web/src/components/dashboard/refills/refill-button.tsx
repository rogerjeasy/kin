"use client";

import { ShoppingBasketIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  ruleId: string;
  label: string;
  working: string;
  /** What Kin says once it has proposed the refill. */
  asked: string;
  /** What Kin says for each reason the request can be refused, and when it cannot be reached. */
  reasons: Readonly<Record<string, string>>;
};

/**
 * Asks Kin to reorder. The server checks the seat, the rule and the family's
 * agreement and answers with a reason when it refuses; the browser only
 * carries the rule's ID. Kin proposes the refill and nothing is bought here.
 */
export function RefillButton({ ruleId, label, working, asked, reasons }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const router = useRouter();

  async function ask() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/refills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ruleId }) });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
      if (body?.ok === true) {
        setMessage({ text: asked, tone: "ok" });
        router.refresh();
      } else {
        setMessage({ text: reasons[body?.reason ?? "unavailable"] ?? reasons["unavailable"] ?? "", tone: "error" });
      }
    } catch {
      setMessage({ text: reasons["unavailable"] ?? "", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <Button type="button" className="h-auto min-h-11 max-w-full whitespace-normal text-start" disabled={busy} onClick={ask}>
        <ShoppingBasketIcon aria-hidden="true" />
        {busy ? working : label}
      </Button>
      <p role={message?.tone === "error" ? "alert" : "status"} className={message?.tone === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>
        {message?.text}
      </p>
    </div>
  );
}
