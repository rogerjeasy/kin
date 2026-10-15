import { exampleFamily, type Sibling } from "@/content/example-family";

/** One colour per share, in the order of the agreed shares. */
export const shareFills = ["fill-share-1", "fill-share-2", "fill-share-3"] as const;
export const shareDots = ["bg-share-1", "bg-share-2", "bg-share-3"] as const;

/** Each sibling keeps the colour of their share on every screen. */
export function shareColor(member: Sibling): { fill: string; dot: string } {
  const index = exampleFamily.shares.findIndex((share) => share.member === member);
  return { fill: shareFills[index] ?? shareFills[0], dot: shareDots[index] ?? shareDots[0] };
}
