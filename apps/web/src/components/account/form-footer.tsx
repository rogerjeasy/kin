import { TextLink } from "@/components/shared/text-link";

type FormFooterProps = { question: string; link: { href: string; label: string } };

/** The way to the other form, for someone who arrived at the wrong one. */
export function FormFooter({ question, link }: FormFooterProps) {
  return (
    <p className="mt-6 flex flex-wrap items-center gap-x-2 text-muted-foreground">
      {question}
      <TextLink href={link.href} className="text-foreground">
        {link.label}
      </TextLink>
    </p>
  );
}
