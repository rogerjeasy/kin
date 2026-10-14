"use client";

import { Direction as DirectionPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import type { Direction } from "@/i18n/locales";

type DirectionProviderProps = { dir: Direction; children: ReactNode };

/** Tells the menu and sheet primitives which way the page reads. */
export function DirectionProvider({ dir, children }: DirectionProviderProps) {
  return <DirectionPrimitive.Provider dir={dir}>{children}</DirectionPrimitive.Provider>;
}
