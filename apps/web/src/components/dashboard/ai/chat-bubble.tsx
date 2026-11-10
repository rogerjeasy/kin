import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { KinMark } from "./kin-mark";

type Props = {
  /** Who speaks: Kin, with its mark at the start, or the person, at the end. */
  from: "kin" | "person";
  className?: string;
  children: ReactNode;
};

/** One turn of a conversation. Side is never the only sign of who spoke: each caller of this names the speaker in words or context. */
export function ChatBubble({ from, className, children }: Props) {
  const kin = from === "kin";
  return (
    <div className={cn("flex min-w-0 items-end gap-3", kin ? "justify-start" : "justify-end")}>
      {kin ? <KinMark /> : null}
      <div
        className={cn(
          "min-w-0 max-w-[min(100%,36rem)] rounded-3xl px-4 py-3 wrap-anywhere motion-safe:animate-scale-in",
          kin ? "rounded-es-md border bg-card shadow-sm" : "rounded-ee-md bg-primary text-primary-foreground shadow-md",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
