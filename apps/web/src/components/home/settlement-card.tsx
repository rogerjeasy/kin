import { Tag } from "@/components/shared/tag";

type SettlementCardProps = { text: string; status: string };

/** The proposed settlement, waiting for a person to approve it. */
export function SettlementCard({ text, status }: SettlementCardProps) {
  return (
    <p className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-[0.9375rem] font-semibold">
      {text}
      <Tag>{status}</Tag>
    </p>
  );
}
