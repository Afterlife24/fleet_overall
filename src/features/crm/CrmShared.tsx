import { useState } from 'react';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/utils/format';
import { type PhaseHistoryEntry, type Quotation, type QuotationPhase } from '@/types/quotation';
import type { CustomerRecord } from '@/types/customerani';
import { ApiErrorNotice } from '@/components/common/ApiStatus';
import { useInvoicesForQuotation } from '@/services/quotationInvoicing';
import { panelState, statusOptions, validateReason } from './statusPanelCore';

const PHASE_STYLE: Record<QuotationPhase, string> = {
  Awaiting: 'bg-amber-50 text-amber-700 border-amber-200',
  Tender: 'bg-sky-50 text-sky-700 border-sky-200',
  Lost: 'bg-rose-50 text-rose-700 border-rose-200',
  Won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function PhaseBadge({ phase }: { phase: QuotationPhase }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', PHASE_STYLE[phase])}>
      {phase}
    </span>
  );
}

/** Asks for a reason. Used for Mark Lost (with presets) and Reopen (free text). */
export function ReasonDialog({
  open, title, description, submitLabel, presets, onClose, onSubmit,
}: {
  open: boolean; title: string; description?: string; submitLabel: string;
  presets?: readonly string[]; onClose: () => void; onSubmit: (reason: string) => void;
}) {
  const [choice, setChoice] = useState<string>('');
  const [text, setText] = useState('');
  const needsText = !presets || choice === 'Other';
  const reason = presets && choice !== 'Other' ? choice : text.trim();
  const check = validateReason(reason);
  const close = () => { setChoice(''); setText(''); onClose(); };

  return (
    <SlideOver
      open={open} onClose={close} title={title} description={description} width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button
            disabled={!check.ok}
            onClick={() => {
              if (!check.ok) return;
              onSubmit(check.reason); setChoice(''); setText('');
            }}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {presets && (
          <div className="space-y-2">
            {presets.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="reason" checked={choice === r} onChange={() => setChoice(r)} />
                {r}
              </label>
            ))}
          </div>
        )}
        {needsText && (
          <Textarea
            placeholder={presets ? 'Describe the reason' : 'Why is this quotation being reopened?'}
            value={text} onChange={(e) => setText(e.target.value)}
          />
        )}
        {!check.ok && reason.length > 0 && <p role="alert" className="text-xs text-destructive">{check.message}</p>}
      </div>
    </SlideOver>
  );
}

export type SaveResult = { ok: true } | { ok: false; error: unknown };

export interface StatusEditorProps {
  /** Saves a phase change through the API. A failure keeps the editor open with the entered reason. */
  onSave: (to: QuotationPhase, reason?: string) => Promise<SaveResult>;
  /** Re-reads the quotations after a 409 conflict. The entered values stay in the editor. */
  onReload?: () => void;
  reloading?: boolean;
}

/** Status select, reason field (Lost and Reopen) and Save. Remounted by the parent when the phase changes. */
function StatusEditor({ q, onSave, onReload, reloading }: { q: Quotation } & StatusEditorProps) {
  const [selected, setSelected] = useState<QuotationPhase>(q.phase);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const options = statusOptions(q.phase);
  const state = panelState(q.phase, selected, reason);
  const reasonCheck = validateReason(reason);
  const reasonMessage = state.needsReason && !reasonCheck.ok ? reasonCheck.message : null;
  const label = selected === 'Lost' ? 'Lost reason' : 'Reopen reason';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await onSave(selected, state.needsReason && reasonCheck.ok ? reasonCheck.reason : undefined);
      if (!res.ok) setError(res.error ?? new Error('Could not change the status'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="status-editor">
      <div className="space-y-1">
        <label htmlFor="crm-status-select" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</label>
        <select
          id="crm-status-select" aria-label="Status"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selected}
          onChange={(e) => { setSelected(e.target.value as QuotationPhase); setError(null); }}
        >
          {options.map((o) => (
            <option key={o.phase} value={o.phase} disabled={!o.allowed && !o.current} title={o.reason}>
              {o.reason ? `${o.phase} - ${o.reason}` : o.phase}
            </option>
          ))}
        </select>
      </div>
      {state.needsReason && (
        <div className="space-y-1">
          <label htmlFor="crm-status-reason" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
          <Textarea
            id="crm-status-reason" aria-label="Reason" value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
          />
          {reasonMessage && <p role="alert" className="text-xs text-destructive">{reasonMessage}</p>}
        </div>
      )}
      {error != null && <ApiErrorNotice error={error} onReload={onReload} reloading={reloading} />}
      <div className="flex justify-end">
        <Button disabled={!state.canSave || saving} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export function QuotationDetail({
  q, onClose, statusEditor, history, historyLoading,
}: {
  q: Quotation | null; onClose: () => void; statusEditor?: StatusEditorProps;
  /** Phase history read from the API; falls back to the history carried by the quotation. */
  history?: PhaseHistoryEntry[]; historyLoading?: boolean;
}) {
  const invoices = useInvoicesForQuotation(q?.id ?? '');
  return (
    <SlideOver open={!!q} onClose={onClose} title={q?.opportunity ?? ''} description={q ? `${q.number} · ${q.customerName}` : undefined} width="md">
      {q && (
        <div className="space-y-6">
          {statusEditor && <StatusEditor key={`${q.id}:${q.phase}`} q={q} {...statusEditor} />}
          <InfoGrid>
            <InfoRow label="Hire Agreement No." value={q.hireAgreementNo || '-'} />
            <InfoRow label="Email" value={q.email ?? '-'} />
            <InfoRow label="Stage" value={<PhaseBadge phase={q.phase} />} />
            <InfoRow label="Expected revenue" value={formatCurrency(q.amount, q.currency)} />
            <InfoRow label="Salesperson" value={q.salesRep ?? '—'} />
            <InfoRow label="Valid until" value={q.validUntil ?? '—'} />
            {q.phase === 'Lost' && <InfoRow label="Lost reason" value={q.lostReason ?? '—'} />}
            {q.phase === 'Lost' && <InfoRow label="Lost by" value={q.lostBy ?? '—'} />}
            {q.notes && <InfoRow label="Notes" value={q.notes} />}
          </InfoGrid>
          <div>
            <SectionTitle>Invoices</SectionTitle>
            {invoices.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No invoices yet</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {invoices.map((inv) => (
                  <li key={inv.id} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{inv.invoiceNo}</span>
                      <span className="text-xs text-muted-foreground">{inv.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {inv.invoiceType ?? '—'} · {inv.periodStart && inv.periodEnd ? `${inv.periodStart} to ${inv.periodEnd}` : '—'}
                    </div>
                    <div className="mt-1 text-xs">{formatCurrency(inv.totalAmount, inv.currency)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <SectionTitle>Phase history</SectionTitle>
            {historyLoading && <p className="mt-2 text-sm text-muted-foreground">Loading history...</p>}
            <ul className="mt-2 space-y-2 text-sm">
              {[...(history ?? q.history)].reverse().map((h) => (
                <li key={h.id} className="rounded-md border border-border p-2">
                  <div className="font-medium">
                    {h.fromPhase ? `${h.fromPhase} → ${h.toPhase}` : `Created as ${h.toPhase}`}
                  </div>
                  <div className="text-xs text-muted-foreground">{h.user} · {formatDateTime(h.timestamp)}</div>
                  {h.reason && <div className="mt-1 text-xs">Reason: {h.reason}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SlideOver>
  );
}

export interface NewQuotationDraft {
  /** API customer id */
  customerId: string;
  opportunity: string;
  email?: string;
  amount: number;
  validUntil?: string;
  notes?: string;
}

export function NewQuotationDialog({
  open, customers, salesperson, onClose, onCreate,
}: {
  open: boolean; customers: CustomerRecord[]; salesperson: string; onClose: () => void;
  /** Creates the quotation through the API. On failure the dialog stays open with every entered value. */
  onCreate: (d: NewQuotationDraft) => Promise<SaveResult>;
}) {
  const [opportunity, setOpportunity] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const valid = opportunity.trim() && customerId && Number(amount) > 0;

  const reset = () => {
    setOpportunity(''); setCustomerId(''); setEmail(''); setAmount(''); setValidUntil(''); setNotes(''); setError(null);
  };
  const close = () => { reset(); onClose(); };

  const onCustomerChange = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c && !email) setEmail(c.email ?? '');
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await onCreate({
        customerId,
        opportunity: opportunity.trim(),
        email: email.trim() || undefined,
        amount: Number(amount),
        validUntil: validUntil || undefined,
        notes: notes || undefined,
      });
      if (res.ok) reset();
      else setError(res.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver
      open={open} onClose={close} title="New quotation" width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={() => void submit()}>{saving ? 'Creating...' : 'Create'}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error != null && <ApiErrorNotice error={error} />}
        <Field label="Customer">
          <select
            aria-label="Customer"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={customerId} onChange={(e) => onCustomerChange(e.target.value)}
          >
            <option value="">Select a customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.customerName} ({c.customerId})</option>)}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">The hire agreement number is allocated when the agreement is created.</p>
        </Field>
        <Field label="Opportunity">
          <Input placeholder="e.g. ABC Company - Boom Lift Hire" value={opportunity} onChange={(e) => setOpportunity(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Salesperson"><Input value={salesperson} readOnly /></Field>
        <Field label="Expected Revenue (AED)">
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Valid until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </SlideOver>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

