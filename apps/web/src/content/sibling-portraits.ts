import type { StaticImageData } from "next/image";

import ana from "@/assets/images/ana.jpg";
import elena from "@/assets/images/elena.jpg";
import marcus from "@/assets/images/marcus.jpg";

import type { Sibling } from "./example-family";

export const siblingPortraits: Record<Sibling, StaticImageData> = { marcus, elena, ana };
