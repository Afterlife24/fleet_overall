import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { PHASES } from '@/types/quotation';
import { cardModel, columnSummary } from './statusPanelCore';
import { PhaseBadge } from './CrmShared';

export interface PipelineBoardProps {
  quotations: Quotation[];
  selectedId: string | null;
  onSelect: (q: Quotation) => void;
  onDropPhase: (q: Quotation, to: QuotationPhase) => void;
}

/** Four columns: Awaiting, Tender, Lost, Won. Cards open the Status panel; drops use the same phase path. */
export function PipelineBoard({ quotations, selectedId, onSelect, onDropPhase }: PipelineBoardProps) {
  const [overCol, setOverCol] = useState<QuotationPhase | null>(null);

  const drop = (e: React.DragEvent, col: QuotationPhase) => {
    e.preventDefault();
    setOverCol(null);
    const q = quotations.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (!q || q.phase === col) return;
    onDropPhase(q, col);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PHASES.map((col) => {
        const items = quotations.filter((q) => q.phase === col);
        const sum = columnSummary(quotations, col);
        return (
          <div
            key={col}
            data-testid={`column-${col}`}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
            onDragLeave={() => setOverCol(null)}
            onDrop={(e) => drop(e, col)}
            className={cn('rounded-lg border border-border bg-muted/30 p-3', overCol === col && 'ring-2 ring-primary')}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PhaseBadge phase={col} />
                <span className="text-sm text-muted-foreground" data-testid={`count-${col}`}>{sum.count}</span>
              </div>
              <span className="text-sm font-medium tabular-nums" data-testid={`amount-${col}`}>{sum.label}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No quotations</p>}
              {items.map((q) => {
                const m = cardModel(q);
                return (
                  <div
                    key={q.id} draggable data-testid={`card-${q.id}`}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', q.id)}
                    className={cn(
                      'cursor-grab rounded-md border border-border bg-background shadow-sm',
                      selectedId === q.id && 'ring-2 ring-primary',
                    )}
                  >
                    <button className="w-full p-3 text-left" onClick={() => onSelect(q)}>
                      <div className="font-mono text-xs font-semibold">{m.number}</div>
                      <div className="mt-0.5 text-sm font-medium">{m.opportunity}</div>
                      <div className="text-xs text-muted-foreground">{m.customerName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{m.hireAgreementNo}</div>
                      <div className="mt-1 text-sm tabular-nums text-muted-foreground">{m.amountLabel}</div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
