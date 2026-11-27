import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { lineAmount, tpsTotal, validateServiceLine } from '@/services/collectionCore';
import { SERVICE_TYPES } from '@/types/collection';
import type { ServiceLine, ServiceType } from '@/types/collection';

export interface ServiceLineTableProps {
  lines: ServiceLine[];
  onChange: (lines: ServiceLine[]) => void;
  readOnly?: boolean;
}

let lineSeq = 0;
function newLineId(): string {
  lineSeq += 1;
  return `tpsl-${Date.now().toString(36)}-${lineSeq}`;
}

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type NumField = 'quantity' | 'rate';

const selectCls =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function ServiceLineTable({ lines, onChange, readOnly = false }: ServiceLineTableProps) {
  // Raw text for numeric cells while typing, and validation messages. Invalid values are never stored.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const key = (id: string, f: NumField) => `${id}:${f}`;

  const update = (id: string, patch: Partial<ServiceLine>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const clearKey = (k: string) => {
    setErrors((e) => {
      if (!(k in e)) return e;
      const rest = { ...e };
      delete rest[k];
      return rest;
    });
  };

  const setNumber = (line: ServiceLine, field: NumField, raw: string) => {
    const k = key(line.id, field);
    setDrafts((d) => ({ ...d, [k]: raw }));
    const parsed = raw.trim() === '' ? NaN : Number(raw);
    const res = validateServiceLine({ ...line, [field]: parsed });
    if (res.ok) {
      clearKey(k);
      update(line.id, { [field]: parsed } as Partial<ServiceLine>);
    } else if (res.field === field) {
      setErrors((e) => ({ ...e, [k]: res.message }));
    }
  };

  const setType = (line: ServiceLine, value: string) => {
    const res = validateServiceLine({ ...line, serviceType: value });
    const k = `${line.id}:serviceType`;
    if (res.ok) {
      clearKey(k);
      update(line.id, { serviceType: value as ServiceType });
    } else if (res.field === 'serviceType') {
      setErrors((e) => ({ ...e, [k]: res.message }));
    }
  };

  const addLine = () =>
    onChange([
      ...lines,
      {
        id: newLineId(),
        provider: '',
        serviceType: 'Other',
        description: '',
        date: '',
        reference: '',
        quantity: 1,
        rate: 0,
      },
    ]);

  const removeLine = (id: string) => {
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${id}:`))));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${id}:`))));
    onChange(lines.filter((l) => l.id !== id));
  };

  const numValue = (line: ServiceLine, f: NumField) => drafts[key(line.id, f)] ?? String(line[f]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Provider</th>
              <th className="px-2 py-2">Service type</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Reference / PO</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Rate</th>
              <th className="px-2 py-2 text-right">Amount</th>
              {!readOnly && <th className="w-10 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 8 : 9} className="px-2 py-6 text-center text-muted-foreground">
                  No service lines
                </td>
              </tr>
            )}
            {lines.map((l) => {
              const typeErr = errors[`${l.id}:serviceType`];
              const qtyErr = errors[key(l.id, 'quantity')];
              const rateErr = errors[key(l.id, 'rate')];
              return (
                <tr key={l.id} className="border-t border-border align-top">
                  <td className="min-w-[8rem] px-2 py-1.5">
                    <Input
                      value={l.provider}
                      disabled={readOnly}
                      aria-label="Provider"
                      onChange={(e) => update(l.id, { provider: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[8rem] px-2 py-1.5">
                    <select
                      className={selectCls}
                      value={l.serviceType}
                      disabled={readOnly}
                      aria-label="Service type"
                      onChange={(e) => setType(l, e.target.value)}
                    >
                      {SERVICE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {typeErr && <p className="mt-1 text-xs text-destructive">{typeErr}</p>}
                  </td>
                  <td className="min-w-[10rem] px-2 py-1.5">
                    <Input
                      value={l.description}
                      disabled={readOnly}
                      aria-label="Description"
                      onChange={(e) => update(l.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[9rem] px-2 py-1.5">
                    <Input
                      type="date"
                      value={l.date}
                      disabled={readOnly}
                      aria-label="Date"
                      onChange={(e) => update(l.id, { date: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[8rem] px-2 py-1.5">
                    <Input
                      value={l.reference}
                      disabled={readOnly}
                      aria-label="Reference or PO"
                      onChange={(e) => update(l.id, { reference: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[6rem] px-2 py-1.5">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      className="text-right"
                      value={numValue(l, 'quantity')}
                      disabled={readOnly}
                      aria-label="Quantity"
                      aria-invalid={!!qtyErr}
                      onChange={(e) => setNumber(l, 'quantity', e.target.value)}
                    />
                    {qtyErr && <p className="mt-1 text-xs text-destructive">{qtyErr}</p>}
                  </td>
                  <td className="min-w-[7rem] px-2 py-1.5">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      className="text-right"
                      value={numValue(l, 'rate')}
                      disabled={readOnly}
                      aria-label="Rate"
                      aria-invalid={!!rateErr}
                      onChange={(e) => setNumber(l, 'rate', e.target.value)}
                    />
                    {rateErr && <p className="mt-1 text-xs text-destructive">{rateErr}</p>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 pt-3 text-right tabular-nums">
                    {fmt(lineAmount(l))}
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove line"
                        onClick={() => removeLine(l.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30 font-medium">
              <td colSpan={7} className="px-2 py-2 text-right">
                Total
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmt(tpsTotal(lines))}</td>
              {!readOnly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus className="mr-1 h-4 w-4" /> Add line
        </Button>
      )}
    </div>
  );
}

export default ServiceLineTable;
