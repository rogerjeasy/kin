type FormHeadingProps = {
  /** Ties the form to this heading. */
  id: string;
  title: string;
  text: string;
};

/** What stands above a form: its name, and one line about it. */
export function FormHeading({ id, title, text }: FormHeadingProps) {
  return (
    <div className="mb-8">
      <h2 id={id} className="font-serif text-subtitle text-balance">
        {title}
      </h2>
      <p className="mt-2 text-muted-foreground">{text}</p>
    </div>
  );
}
