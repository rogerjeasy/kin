import { Tag } from "@/components/shared/tag";

type FormHeadingProps = {
  /** Ties the form to this heading. */
  id: string;
  title: string;
  text: string;
  /** Says up front that accounts are not open yet. */
  status: string;
};

/** What stands above a form: its name, one line about it, and where things stand. */
export function FormHeading({ id, title, text, status }: FormHeadingProps) {
  return (
    <div className="mb-8">
      <Tag>{status}</Tag>
      <h2 id={id} className="mt-4 font-serif text-subtitle text-balance">
        {title}
      </h2>
      <p className="mt-2 text-muted-foreground">{text}</p>
    </div>
  );
}
