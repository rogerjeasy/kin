import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Button } from "@/components/ui/button";

type Props = { title: string; text: string; action?: { href: string; label: string } };

/** What the consent screen says when there is nothing to ask the person: a visitor, a request Kin cannot read, a demo circle. */
export function OAuthNotice({ title, text, action }: Props) {
  return (
    <PageHeader
      title={title}
      lede={text}
      actions={
        action ? (
          <Button asChild className="h-auto min-h-11 w-full max-w-full py-2 whitespace-normal sm:w-auto">
            {/* A route of the sign-in flow, not a page: a plain link, so the browser follows its redirects. */}
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : undefined
      }
    />
  );
}
