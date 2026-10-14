import { Fragment, type ReactNode } from "react";

import { parseTemplate } from "@/i18n/template";

type RichTextProps = {
  template: string;
  /** What to render in place of each {slot}. */
  slots: Record<string, ReactNode>;
};

/** A translated sentence with marked-up pieces dropped into its slots. */
export function RichText({ template, slots }: RichTextProps) {
  return parseTemplate(template).map((part, index) => (
    <Fragment key={index}>{part.kind === "text" ? part.text : slots[part.name]}</Fragment>
  ));
}
