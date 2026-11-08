/** One row of the calendar: a person. */
export type CalendarResource = { readonly id: string; readonly name: string };

/** One shift. Every word in it arrives already translated. */
export type CalendarEvent = {
  /** The shift's id. */
  readonly id: string;
  /** The member's id. */
  readonly resourceId: string;
  readonly title: string;
  /** ISO instant. */
  readonly startsAt: string;
  /** ISO instant. */
  readonly endsAt: string;
  /** Drives the colour: scheduled, waiting for a key, both keys turned, paid, cancelled. */
  readonly tone: "neutral" | "pending" | "ready" | "paid" | "cancelled";
  /** Shown on the shift, in its tooltip and in its accessible name. */
  readonly statusText: string;
};

export type CareCalendarProps = {
  readonly resources: readonly CalendarResource[];
  readonly events: readonly CalendarEvent[];
  /** YYYY-MM-DD, the Monday (or the locale's first day) the week view starts on, in the circle's timezone. */
  readonly weekStart: string;
  /** IANA, the circle's own; events are shown on that clock. */
  readonly timezone: string;
  /** BCP-47 language tag the app is in (en, fr, de, es, it, ar, he). */
  readonly locale: string;
  readonly dir: "ltr" | "rtl";
  /** ISO instant, the circle's clock (a demo circle's clock can differ from real time); draws the "now" line. */
  readonly now: string;
  /** Called when a shift is activated by click, tap or keyboard. */
  readonly onSelect?: (eventId: string) => void;
  /** Accessible name of the whole calendar, already translated. */
  readonly label: string;
  /** Switches on the experimental assistant, which only answers and highlights, with its words in the viewer's language. */
  readonly assistant?: AssistantCopy;
};

/** The words around the assistant: what it is, what it may do and what to try. */
export type AssistantCopy = { readonly experimental: string; readonly title: string; readonly note: string; readonly examples: string; readonly unavailable: string };
