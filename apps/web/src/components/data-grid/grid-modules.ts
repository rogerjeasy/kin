import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  CsvExportModule,
  DateFilterModule,
  EventApiModule,
  GridStateModule,
  LocaleModule,
  NumberFilterModule,
  PinnedRowModule,
  QuickFilterModule,
  RenderApiModule,
  RowAutoHeightModule,
  RowApiModule,
  RowSelectionModule,
  RowStyleModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
} from "ag-grid-community";

/**
 * Every AG Grid module Kin's grids use, registered in this one place. Each is
 * a Community module: no licence, and nothing beyond what a feature needs
 * reaches the page. In development the validation module explains, in words,
 * any feature used without its module.
 */
export const gridModules = [
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  RowApiModule,
  RowAutoHeightModule,
  RowSelectionModule,
  RowStyleModule,
  CellStyleModule,
  ColumnApiModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  QuickFilterModule,
  PinnedRowModule,
  CsvExportModule,
  GridStateModule,
  LocaleModule,
  EventApiModule,
  RenderApiModule,
  TooltipModule,
  ...(process.env.NODE_ENV === "production" ? [] : [ValidationModule]),
];
