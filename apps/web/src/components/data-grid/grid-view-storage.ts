import type { GridState, SortModelItem } from "ag-grid-community";

/**
 * What a person's grid remembers between visits: which columns they chose,
 * their order, the sort and the filters. Not the scroll, the focus or the
 * selection, and not column widths, which belong to the screen they open it on.
 */
export type StoredGridState = Pick<GridState, "columnOrder" | "columnVisibility" | "filter" | "sort">;

export type StoredView = {
  readonly version: 1;
  readonly grid: StoredGridState;
  /** The grid's own search box, if it has one. */
  readonly query: string;
  /** How the screen groups its rows, if it can. */
  readonly groupBy: string;
};

/** The two calls of the browser's storage that a view needs. Local storage satisfies it. */
export type ViewStorage = Pick<Storage, "getItem" | "setItem">;

const MAX_QUERY_LENGTH = 200;
const MAX_COLUMNS = 100;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_COLUMNS && value.every((item) => typeof item === "string");

function parseSort(value: unknown): StoredGridState["sort"] {
  if (!isRecord(value) || !Array.isArray(value.sortModel)) return undefined;
  const sortModel: SortModelItem[] = [];
  for (const item of value.sortModel.slice(0, 5)) {
    if (isRecord(item) && typeof item.colId === "string" && (item.sort === "asc" || item.sort === "desc")) {
      sortModel.push({ colId: item.colId, sort: item.sort });
    }
  }
  return { sortModel };
}

function parseFilter(value: unknown): StoredGridState["filter"] {
  if (!isRecord(value) || !isRecord(value.filterModel)) return undefined;
  return { filterModel: value.filterModel };
}

/** Keeps only what a view stores, and drops anything that does not have the shape the grid expects. */
export function pickGridState(state: unknown): StoredGridState {
  if (!isRecord(state)) return {};
  const picked: StoredGridState = {};
  const sort = parseSort(state.sort);
  if (sort) picked.sort = sort;
  const filter = parseFilter(state.filter);
  if (filter) picked.filter = filter;
  if (isRecord(state.columnVisibility) && isTextList(state.columnVisibility.hiddenColIds)) {
    picked.columnVisibility = { hiddenColIds: state.columnVisibility.hiddenColIds };
  }
  if (isRecord(state.columnOrder) && isTextList(state.columnOrder.orderedColIds)) {
    picked.columnOrder = { orderedColIds: state.columnOrder.orderedColIds };
  }
  return picked;
}

/** Reads a stored view, or `null` when the text is missing, not JSON or not a view of this version. */
export function parseView(text: string | null): StoredView | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1) return null;
  return {
    version: 1,
    grid: pickGridState(value.grid),
    query: typeof value.query === "string" ? value.query.slice(0, MAX_QUERY_LENGTH) : "",
    groupBy: typeof value.groupBy === "string" ? value.groupBy : "none",
  };
}

/** The view as text for storage, holding only what a view stores. */
export function serializeView(view: Omit<StoredView, "version">): string {
  const stored: StoredView = { version: 1, grid: pickGridState(view.grid), query: view.query.slice(0, MAX_QUERY_LENGTH), groupBy: view.groupBy };
  return JSON.stringify(stored);
}

/** The browser's local storage, or `null` when it is blocked or missing (a private window, blocked site data). */
export function browserStorage(): ViewStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The stored view for `key`. Storage that fails reads as no view, and the grid starts as it was built. */
export function readView(storage: ViewStorage | null, key: string): StoredView | null {
  try {
    return parseView(storage?.getItem(key) ?? null);
  } catch {
    return null;
  }
}

/** Stores the view. Returns whether it was saved: a full or blocked store loses a preference, nothing else. */
export function writeView(storage: ViewStorage | null, key: string, view: Omit<StoredView, "version">): boolean {
  try {
    storage?.setItem(key, serializeView(view));
    return storage !== null;
  } catch {
    return false;
  }
}
