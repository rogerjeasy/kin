import type { SchedulerConfig } from "@bryntum/scheduler";

import { ASSISTANT_LOCALE_HEADER, ASSISTANT_URL } from "@/content/circle/shift-assistant-protocol";

import type { BryntumModule } from "./bryntum-runtime.ts";

/**
 * The calendar's experimental assistant. It only answers and filters what the
 * viewer already sees. Three things keep it from ever changing the calendar:
 * the route drops every tool that would add, update or remove a record before
 * the model sees the list; any change the widget is asked to make waits for
 * a confirmation, which the stores then refuse; and the stores veto every
 * add, update and removal that does not come from the page's own refresh,
 * which swaps in data from the server (the calendar is rebuilt from the
 * server on every refresh anyway).
 */
export function assistantFeature(bryntum: BryntumModule, locale: string): NonNullable<NonNullable<SchedulerConfig["features"]>["ai"]> {
  return {
    apiPlugin: bryntum.AnthropicPlugin,
    promptUrl: ASSISTANT_URL,
    // The browser sends only what the user typed and what the calendar shows; the server holds the model's settings and keys.
    fetchOptions: { credentials: "same-origin", headers: { [ASSISTANT_LOCALE_HEADER]: locale } },
    requireConfirmationOnAdds: true,
    requireConfirmationOnRemovals: true,
    requireConfirmationOnUpdates: true,
    chatButton: true,
    // Nothing is undone or redone, and no speech service is configured: nothing is spoken or recorded.
    undo: false,
    redo: false,
  };
}

const VETO = { beforeAdd: () => false, beforeRemove: () => false, beforeUpdate: () => false } as const;

/**
 * Stores that refuse every add, update and removal made on a record. The
 * page's own refresh replaces a store's whole data, which is not any of
 * these, so the calendar still follows the server while nothing the widget
 * is asked to do can change a shift or a person.
 */
export const READ_ONLY_STORES = { eventStore: { listeners: VETO }, resourceStore: { listeners: VETO } } satisfies Pick<SchedulerConfig, "eventStore" | "resourceStore">;
