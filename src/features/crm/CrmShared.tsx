import { useState } from 'react';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/utils/format';
import { type Quotation, type QuotationDraft, type QuotationPhase } from '@/types/quotation';
import { useInvoicesForQuotation } from '@/services/quotationInvoicing';
import { companiesOf, nextHireAgreementNo } from './crmRules';
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

export interface StatusEditorProps {
  onSave: (to: QuotationPhase, reason?: string) => { ok: boolean; error?: string };
}

/** Status select, reason field (Lost and Reopen) and Save. Remounted by the parent when the phase changes. */
function StatusEditor({ q, onSave }: { q: Quotation; onSave: StatusEditorProps['onSave'] }) {
  const [selected, setSelected] = useState<QuotationPhase>(q.phase);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = statusOptions(q.phase);
  const state = panelState(q.phase, selected, reason);
  const reasonCheck = validateReason(reason);
  const reasonMessage = state.needsReason && !reasonCheck.ok ? reasonCheck.message : null;
  const label = selected === 'Lost' ? 'Lost reason' : 'Reopen reason';

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
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button
          disabled={!state.canSave}
          onClick={() => {
            const res = onSave(selected, state.needsReason && reasonCheck.ok ? reasonCheck.reason : undefined);
            if (!res.ok) setError(res.error ?? 'Could not change the status');
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function QuotationDetail({
  q, onClose, statusEditor,
}: { q: Quotation | null; onClose: () => void; statusEditor?: StatusEditorProps }) {
  const invoices = useInvoicesForQuotation(q?.id ?? '');
  return (
    <SlideOver open={!!q} onClose={onClose} title={q?.opportunity ?? ''} description={q ? `${q.number} · ${q.customerName}` : undefined} width="md">
      {q && (
        <div className="space-y-6">
          {statusEditor && <StatusEditor key={`${q.id}:${q.phase}`} q={q} onSave={statusEditor.onSave} />}
          <InfoGrid>
            <InfoRow label="Hire Agreement No." value={q.hireAgreementNo} />
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
            <ul className="mt-2 space-y-2 text-sm">
              {[...q.history].reverse().map((h) => (
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

export function NewQuotationDialog({
  open, quotations, salesperson, onClose, onCreate,
}: {
  open: boolean; quotations: Quotation[]; salesperson: string; onClose: () => void;
  onCreate: (d: QuotationDraft) => void;
}) {
  const companies = companiesOf(quotations);
  const [haInput, setHaInput] = useState('');
  const [haTouched, setHaTouched] = useState(false);
  const [opportunity, setOpportunity] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  const norm = (s: string) => s.trim().toLowerCase();
  const byName = companies.find((c) => contactName.trim() && norm(c.customerName) === norm(contactName));
  // Until the user edits the number: an existing company's number if the name matches, else the next free one.
  const suggested = byName ? byName.hireAgreementNo : nextHireAgreementNo(quotations);
  const haNo = haTouched ? haInput.trim() : suggested;
  const match = companies.find((c) => norm(c.hireAgreementNo) === norm(haNo));
  const isExisting = !!match;
  const valid = opportunity.trim() && contactName.trim() && haNo && Number(amount) > 0;

  const reset = () => {
    setHaInput(''); setHaTouched(false); setOpportunity(''); setContactName(''); setEmail('');
    setAmount(''); setValidUntil(''); setNotes('');
  };
  const close = () => { reset(); onClose(); };

  const onHaChange = (v: string) => {
    setHaInput(v); setHaTouched(true);
    // An existing number was entered: fill in that company's details.
    const m = companies.find((c) => norm(c.hireAgreementNo) === norm(v));
    if (m) { setContactName(m.customerName); setEmail(m.email ?? ''); }
  };
  const onNameChange = (v: string) => {
    setContactName(v);
    const m = companies.find((c) => v.trim() && norm(c.customerName) === norm(v));
    if (m && !email) setEmail(m.email ?? '');
  };

  return (
    <SlideOver
      open={open} onClose={close} title="New quotation" width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button disabled={!valid} onClick={() => {
            onCreate({
              opportunity: opportunity.trim(),
              customerName: contactName.trim(),
              customerId: match?.customerId,
              email: email.trim() || undefined,
              hireAgreementNo: haNo,
              amount: Number(amount),
              validUntil: validUntil || undefined,
              notes: notes || undefined,
            });
            reset();
          }}>Create</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Hire Agreement No.">
          <Input
            list="crm-ha-options" value={haTouched ? haInput : suggested}
            onChange={(e) => onHaChange(e.target.value)} placeholder="HA-2026-00001"
          />
          <datalist id="crm-ha-options">
            {companies.map((c) => (
              <option key={c.hireAgreementNo} value={c.hireAgreementNo}>{c.customerName}</option>
            ))}
          </datalist>
          <p className="mt-1 text-xs text-muted-foreground">
            {isExisting
              ? `Existing agreement of ${match!.customerName}. This quotation is added under the same number.`
              : 'Auto-generated for a new company. Edit it, or pick/enter an old number to reuse it.'}
          </p>
        </Field>
        <Field label="Opportunity">
          <Input placeholder="e.g. ABC Company - Boom Lift Hire" value={opportunity} onChange={(e) => setOpportunity(e.target.value)} />
        </Field>
        <Field label="Contact Name">
          <Input placeholder="Company / contact name" value={contactName} onChange={(e) => onNameChange(e.target.value)} />
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

