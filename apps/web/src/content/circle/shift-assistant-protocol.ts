/** Where the calendar widget sends its prompts: our own route, nothing else. */
export const ASSISTANT_URL = "/api/shifts/assistant";
/** Tells the route which language to answer in. It is read only after the route has checked it is one of ours. */
export const ASSISTANT_LOCALE_HEADER = "x-kin-locale";
