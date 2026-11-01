import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sortedFields, type FieldDef } from '@/types/schema';

/**
 * Schema-driven add/edit form. Renders one input per field based on its type.
 * Known system keys are written to the record root; unknown (custom) keys are
 * written to a `fields` bag so they round-trip without a fixed model.
 *
 * Reusable across any app — pass the app's schema + an existing record (edit)
 * or none (add). Returns the assembled values via onSave.
 */
export function SchemaForm({
  title,
  schema,
  record,
  open,
  onClose,
  onSave,
  systemKeys,
}: {
  title: string;
  schema: FieldDef[];
  record?: Record<string, any> | null;
  open: boolean;
  onClose: () => void;
  onSave: (values: Record<string, any>) => void;
  /** keys written to the record root (system fields); others go to `fields`. */
  systemKeys: Set<string>;
}) {
  const fields = sortedFields({ appId: '', fields: schema });
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!open) return;
    const init: Record<string, any> = {};
    for (const f of fields) {
      const existing = record?.[f.key] ?? record?.fields?.[f.key];
      init[f.key] = existing ?? (f.type === 'boolean' ? false : '');
    }
    setValues(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record]);

  const set = (key: string, v: any) => setValues((s) => ({ ...s, [key]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Split values into root (system) vs custom `fields` bag.
    const root: Record<string, any> = {};
    const bag: Record<string, any> = {};
    for (const f of fields) {
      const val = values[f.key];
      if (systemKeys.has(f.key)) root[f.key] = val;
      else bag[f.key] = val;
    }
    onSave({ ...root, fields: { ...(record?.fields ?? {}), ...bag } });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={cnField(f)}>
                <label className="text-sm font-medium text-foreground">
                  {f.label}{f.required && <span className="text-rose-500"> *</span>}
                </label>
                {f.type === 'select' ? (
                  <Select value={String(values[f.key] ?? '')} onValueChange={(v) => set(f.key, v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : f.type === 'boolean' ? (
                  <div className="mt-2">
                    <input type="checkbox" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked)} className="h-4 w-4" />
                  </div>
                ) : (
                  <Input
                    type={f.type === 'number' || f.type === 'currency' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    required={f.required}
                    className="mt-1"
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function cnField(f: FieldDef): string {
  // long text-ish fields span both columns for a cleaner layout
  return f.type === 'select' || f.type === 'boolean' ? 'space-y-0' : 'space-y-0';
}
