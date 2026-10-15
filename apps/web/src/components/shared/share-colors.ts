import { exampleFamily, type Sibling } from "@/content/example-family";

/** One colour per share, in the order of the agreed shares. */
export const shareFills = ["fill-share-1", "fill-share-2", "fill-share-3"] as const;
export const shareDots = ["bg-share-1", "bg-share-2", "bg-share-3"] as const;

/** The colour of the share at `index` in the agreement. More shares than colours wrap around. */
export function shareColorAt(index: number): { fill: string; dot: string } {
  const at = ((index % shareFills.length) + shareFills.length) % shareFills.length;
  return { fill: shareFills[at] ?? shareFills[0], dot: shareDots[at] ?? shareDots[0] };
}

/** Each sibling of the example family keeps the colour of their share on every page. */
export function shareColor(member: Sibling): { fill: string; dot: string } {
  return shareColorAt(exampleFamily.shares.findIndex((share) => share.member === member));
}
