import type { StaticImageData } from "next/image";

import amara from "@/assets/images/amara.jpg";
import roseFace from "@/assets/images/rose-face.jpg";

import type { Sibling } from "./example-family";
import { siblingPortraits } from "./sibling-portraits";

export type CircleMember = "rose" | Sibling | "amara";

/** A small portrait of everyone in Rose's circle. */
export const circlePortraits: Record<CircleMember, StaticImageData> = {
  rose: roseFace,
  ...siblingPortraits,
  amara,
};
