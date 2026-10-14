type ConsentFieldProps = {
  id: string;
  name: string;
  label: string;
  /** The message to show when the box was left unticked. */
  error?: string;
};

/** A statement the person must tick before going on. */
export function ConsentField({ id, name, label, error }: ConsentFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="grid min-h-11 cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 text-[0.9375rem]">
        <input
          id={id}
          name={name}
          type="checkbox"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-0.5 size-5 accent-primary"
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
