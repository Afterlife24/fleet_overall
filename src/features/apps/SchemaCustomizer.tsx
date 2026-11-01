import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { getApp } from '@/constants/apps';
import type { FieldDef, FieldType } from '@/types/schema';
import { sortedFields } from '@/types/schema';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Eye, EyeOff, Filter } from 'lucide-react';

const TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency (AED)' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
  { value: 'boolean', label: 'Yes / No' },
];

/**
 * Reusable per-app field customizer ("mini Studio"). Works for ANY company and
 * ANY app id — the schema is stored per org per app, so every company edits its
 * own. Owner can add / rename / retype / reorder / show-in-table / delete.
 */
export function SchemaCustomizer({ appId, open, onClose }: { appId: string; open: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const getAppSchema = useOrgStore((s) => s.getAppSchema);
  const setAppSchema = useOrgStore((s) => s.setAppSchema);
  const resetAppSchema = useOrgStore((s) => s.resetAppSchema);

  const [fields, setFields] = useState<FieldDef[]>([]);

  useEffect(() => {
    if (open && user) setFields(sortedFields({ appId, fields: getAppSchema(user.orgId, appId) }));
  }, [open, user, appId, getAppSchema]);

  if (!user) return null;
  const app = getApp(appId);

  const renumber = (list: FieldDef[]) => list.map((f, i) => ({ ...f, order: i }));
  const update = (key: string, patch: Partial<FieldDef>) =>
    setFields((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const move = (idx: number, dir: -1 | 1) =>
    setFields((list) => {
      const j = idx + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[idx], next[j]] = [next[j], next[idx]];
      return renumber(next);
    });
  const remove = (key: string) => setFields((list) => renumber(list.filter((f) => f.key !== key)));
  const addField = () => {
    const key = `custom_${Date.now().toString(36)}`;
    setFields((list) => renumber([...list, { key, label: `New Field ${list.length + 1}`, type: 'text', order: list.length, inTable: true }]));
  };

  const save = () => {
    setAppSchema(user.orgId, appId, renumber(fields));
    toastSuccess(`${app?.name ?? 'App'} fields saved`);
    onClose();
  };
  const reset = () => {
    resetAppSchema(user.orgId, appId);
    toastSuccess('Fields reset to default');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize {app?.name} fields</DialogTitle>
          <DialogDescription>
            Rename, change type, reorder, show/hide, add or delete fields for this company.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {fields.map((f, idx) => (
            <div key={f.key} className="rounded-lg border border-border bg-card p-3">
              {/* Row 1: label + type + delete */}
              <div className="flex items-center gap-2">
                <Input
                  value={f.label}
                  onChange={(e) => update(f.key, { label: e.target.value })}
                  placeholder="Field label"
                  className="h-9 flex-1"
                />
                <Select value={f.type} onValueChange={(v) => update(f.key, { type: v as FieldType })}>
                  <SelectTrigger className="h-9 w-36 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => remove(f.key)} title="Delete field">
                  <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                </Button>
              </div>

              {/* Row 2: controls */}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => update(f.key, { inTable: !f.inTable })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                    f.inTable ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  )}
                >
                  {f.inTable ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {f.inTable ? 'In table' : 'Hidden'}
                </button>
                <button
                  onClick={() => update(f.key, { filterable: !f.filterable })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                    f.filterable ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  )}
                  title="Show a filter for this field in the filter bar"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {f.filterable ? 'Filter on' : 'No filter'}
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={idx === 0} onClick={() => move(idx, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={idx === fields.length - 1} onClick={() => move(idx, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Options editor for dropdown fields */}
              {f.type === 'select' && (
                <div className="mt-2">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Dropdown options (comma separated)</label>
                  <Input
                    value={(f.options ?? []).join(', ')}
                    onChange={(e) => update(f.key, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="Option 1, Option 2, Option 3"
                    className="mt-1 h-8 text-xs"
                  />
                </div>
              )}
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addField} className="mt-1">
            <Plus className="mr-1.5 h-4 w-4" /> Add field
          </Button>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reset to default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save fields</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
