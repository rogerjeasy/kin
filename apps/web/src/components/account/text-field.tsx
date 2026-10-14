type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  type: "text" | "email";
  /** Tells the browser what to offer, so nobody types what it already knows. */
  autoComplete: string;
  placeholder: string;
  help?: string;
  /** The message to show when the field needs correcting. Absent when it is fine. */
  error?: string;
};

/** A labelled field with its hint and, when needed, what to correct. */
export function TextField({ id, name, label, type, autoComplete, placeholder, help, error }: TextFieldProps) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {help ? (
        <p id={helpId} className="mt-0.5 text-sm text-muted-foreground">
          {help}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="mt-2 min-h-12 w-full rounded-xl border border-input bg-card px-4 text-base placeholder:text-muted-foreground aria-invalid:border-danger"
      />
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
