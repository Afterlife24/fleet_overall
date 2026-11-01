import { Filter } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { FieldDef } from '@/types/schema';

/**
 * Schema-driven filter bar. Renders one control per filterable field:
 *  - select fields  → a dropdown of their options (+ "All")
 *  - everything else → a text contains-search box
 *
 * Reads/writes a `values` map keyed by field key; the page applies them.
 * Reusable across any app.
 */
export function SchemaFilterBar({
  fields,
  values,
  onChange,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Filter className="h-4 w-4 text-muted-foreground" />
      {fields.map((f) => (
        <div key={f.key} className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{f.label}:</span>
          {f.type === 'select' ? (
            <Select value={values[f.key] ?? 'All'} onValueChange={(v) => onChange(f.key, v)}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                {(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
              placeholder={`Filter ${f.label.toLowerCase()}`}
              className="h-8 w-40"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Apply schema filter values to a list of records. */
export function applySchemaFilters<T extends Record<string, any>>(
  rows: T[],
  fields: FieldDef[],
  values: Record<string, string>,
): T[] {
  return rows.filter((row) =>
    fields.every((f) => {
      const v = values[f.key];
      if (!v || v === 'All') return true;
      const cell = String(row[f.key] ?? row.fields?.[f.key] ?? '').toLowerCase();
      return f.type === 'select' ? cell === v.toLowerCase() : cell.includes(v.toLowerCase());
    })
  );
}
