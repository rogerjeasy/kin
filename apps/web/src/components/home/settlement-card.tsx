import { Tag } from "@/components/shared/tag";

type SettlementCardProps = { text: string; status: string };

/** The proposed settlement, waiting for a person to approve it. */
export function SettlementCard({ text, status }: SettlementCardProps) {
  return (
    <p className="surface glow-edge mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-4 py-3.5 text-[0.9375rem] font-semibold shadow-md">
      <span className="inline-flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="relative grid size-2.5 shrink-0 place-items-center">
          <span className="absolute inset-0 rounded-full bg-gold motion-safe:animate-dot-ping" />
          <span className="size-2.5 rounded-full bg-gold" />
        </span>
        <span className="min-w-0">{text}</span>
      </span>
      <Tag>{status}</Tag>
    </p>
  );
}
