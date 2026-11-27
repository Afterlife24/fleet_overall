import { AppError } from '../../errors.js';

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'BOOLEAN'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** The part of a `custom_field_definitions` row needed to validate values. */
export interface CustomFieldDef {
  fieldKey: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: readonly string[];
}

const MAX_TEXT = 2000;
const CURRENCY_RE = /^-?\d{1,15}(\.\d{1,4})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Returns the error code for a value of the wrong shape, or undefined when it is valid for the field. */
function checkValue(def: CustomFieldDef, value: unknown): string | undefined {
  switch (def.fieldType) {
    case 'TEXT':
      return typeof value === 'string' && value.length <= MAX_TEXT ? undefined : 'invalid_text';
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'invalid_number';
    case 'CURRENCY':
      if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'invalid_currency';
      return typeof value === 'string' && CURRENCY_RE.test(value) ? undefined : 'invalid_currency';
    case 'DATE':
      return typeof value === 'string' && isCalendarDate(value) ? undefined : 'invalid_date';
    case 'SELECT':
      return typeof value === 'string' && def.options.includes(value) ? undefined : 'invalid_option';
    case 'BOOLEAN':
      return typeof value === 'boolean' ? undefined : 'invalid_boolean';
  }
}

/**
 * Validates `custom_attributes` against the ACTIVE field definitions of an entity type.
 * Unknown keys, wrong types, values outside SELECT options and missing required fields are 422 with one
 * field error per key (`customAttributes.<key>`). `null` or an empty string clears an optional field.
 * Returns the cleaned attributes (cleared fields omitted).
 */
export function validateCustomAttributes(
  defs: readonly CustomFieldDef[],
  input: unknown,
): Record<string, unknown> {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('VALIDATION_ERROR', 'customAttributes must be an object', { customAttributes: 'invalid_type' });
  }
  const attrs = input as Record<string, unknown>;
  const byKey = new Map(defs.map((d) => [d.fieldKey, d]));
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attrs)) {
    const def = byKey.get(key);
    if (!def) {
      errors[`customAttributes.${key}`] = 'unknown_field';
      continue;
    }
    if (value === null || value === '') continue; // cleared; required check below
    const problem = checkValue(def, value);
    if (problem) errors[`customAttributes.${key}`] = problem;
    else out[key] = value;
  }
  for (const def of defs) {
    if (def.required && !(def.fieldKey in out) && !(`customAttributes.${def.fieldKey}` in errors)) {
      errors[`customAttributes.${def.fieldKey}`] = 'required';
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Custom attributes are invalid', errors);
  }
  return out;
}
