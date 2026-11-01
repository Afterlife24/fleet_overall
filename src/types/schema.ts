/**
 * Customizable field schema (the "mini Studio" model).
 *
 * An app's table/form is described by a list of FieldDef records stored per org
 * per app. Companies can add, rename, remove and reorder fields. The table
 * renders its columns from the schema; the form renders its inputs from it.
 *
 * BACKEND-READY: a schema is pure data. `schemaService` reads/writes it; later
 * that becomes an API (e.g. GET/PUT /apps/:appId/schema) and these same shapes
 * map to an `ir.model.fields`-style table.
 */

export type FieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'boolean';

export interface FieldDef {
  /** stable key used in the record's data bag (e.g. "supplierName") */
  key: string;
  /** display label shown in table header / form label */
  label: string;
  type: FieldType;
  required?: boolean;
  /** options for a 'select' field */
  options?: string[];
  /** render order (ascending) */
  order: number;
  /** system fields ship with the app; can be hidden/renamed but not deleted */
  system?: boolean;
  /** whether the column is shown in the table (form always shows it) */
  inTable?: boolean;
  /** whether a filter control for this field appears in the filter bar */
  filterable?: boolean;
}

export function filterableFields(schema: AppSchema): FieldDef[] {
  return sortedFields(schema).filter((f) => f.filterable);
}

export interface AppSchema {
  appId: string;
  fields: FieldDef[];
}

export function sortedFields(schema: AppSchema): FieldDef[] {
  return [...schema.fields].sort((a, b) => a.order - b.order);
}

export function tableFields(schema: AppSchema): FieldDef[] {
  return sortedFields(schema).filter((f) => f.inTable !== false);
}
