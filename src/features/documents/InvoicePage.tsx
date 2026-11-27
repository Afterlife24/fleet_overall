import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate, describeApiError, errorText } from '@/components/common/ApiStatus';
import { useCrmData, useSubmission } from '@/hooks/useApiResources';
import {
  fetchInvoice, useCreateInvoice, useInvoicePermission, useInvoicePrefill, useInvoices, useIssueInvoice, useUpdateInvoice,
} from '@/hooks/api/useInvoicesApi';
import type { InvoiceDto, InvoicePrefillDto, InvoiceTypeValue, InvoiceUpdateDto } from '@/services/api/invoices';
import { invoiceFromDto } from '@/services/api/invoiceMappers';
import { browserOrgId } from '@/services/api/readAdapters';
import type { TaxInvoice } from '@/types/taxinvoice';
import { Plus, Download, ArrowLeft, FileText, X } from 'lucide-react';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { CancelInvoiceDialog, PaymentStatusDialog } from './InvoiceDialogs';

const money = (n: number) =>
  (n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const to2 = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

const cell = 'border border-gray-200 px-3 py-1.5';
const lab = `${cell} text-gray-600 w-40`;
const inp = 'rounded border border-gray-300 bg-white px-2 py-1 text-xs';
const h2 = 'mb-2 text-sm font-bold uppercase text-blue-900';

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Invoice screen. Reads and writes `/api/v1/invoices`; numbers, totals and snapshots come from the server. */
export function InvoicePage() {
  return (
    <ApiSessionGate>
      <InvoiceScreen />
    </ApiSessionGate>
  );
}

/** Editable values of the form. Amounts are decimal strings, as the API expects. */
interface FormState {
  invoiceDate: string;
  periodEnd: string;
  quantity: string;
  unitRate: string;
  amount: string;
  transport: string;
  notes: string;
  chargeConfirmed: boolean;
  repeatConfirmed: boolean;
}

const EMPTY_FORM: FormState = {
  invoiceDate: '', periodEnd: '', quantity: '1', unitRate: '0.00', amount: '0.00', transport: '0.00', notes: '',
  chargeConfirmed: false, repeatConfirmed: false,
};

function formFromPrefill(p: InvoicePrefillDto): FormState {
  return {
    invoiceDate: p.invoiceDate,
    periodEnd: p.invoiceType === 'Off-Hire' ? (p.periodEnd ?? p.hireEndDate) : p.suggestedPeriodEnd,
    quantity: p.equipment.quantity, unitRate: p.equipment.unitRate, amount: p.equipment.amount,
    transport: p.transport.amount, notes: '', chargeConfirmed: false, repeatConfirmed: false,
  };
}

function formFromInvoice(i: InvoiceDto): FormState {
  const eq = i.lines.find((l) => l.lineType === 'EQUIPMENT');
  const tr = i.lines.find((l) => l.lineType === 'TRANSPORT');
  return {
    invoiceDate: i.invoiceDate, periodEnd: i.periodEnd,
    quantity: eq?.quantity ?? '1', unitRate: eq?.unitRate ?? '0.00', amount: eq?.amount ?? '0.00',
    transport: tr?.amount ?? '0.00', notes: i.notes ?? '', chargeConfirmed: false, repeatConfirmed: false,
  };
}

/** The document the page renders for a not yet saved invoice. */
function viewFromPrefill(p: InvoicePrefillDto, orgId: string): TaxInvoice {
  const iss = p.issuerSnapshot;
  const cus = p.customerSnapshot;
  return {
    id: '', orgId, quotationId: p.quotationId, hireAgreementId: p.hireAgreementId, invoiceType: p.invoiceType,
    periodStart: p.periodStart, periodEnd: p.periodEnd ?? p.suggestedPeriodEnd,
    invoiceNo: '', invoiceDate: p.invoiceDate, dueDate: p.dueDate, currency: p.currencyCode, status: 'Draft',
    issuerName: text(iss.name), issuerAddress: text(iss.address), issuerPhone: text(iss.contact), issuerEmail: text(iss.email),
    issuerTradeLicense: text(iss.tradeLicense), issuerTrn: text(iss.taxRegistrationNo),
    customerId: text(cus.customerCode), customerName: text(cus.name), customerTrn: text(cus.taxRegistrationNo),
    attn: text(cus.attention), contactNumber: text(cus.contact), customerEmail: text(cus.email),
    billingAddress: text(cus.billingAddress) || text(cus.address),
    hireAgreementNo: p.agreementNo, hirePeriod: '', deliveryLocation: p.deliveryLocation, paymentTerms: p.paymentTerms,
    equipmentDescription: p.equipment.description, equipmentQty: 0, equipmentRate: 0, equipmentAmount: 0,
    transportationQty: 1, transportationRate: 0, transportationAmount: 0, subtotal: 0, vat: 0, totalAmount: 0,
    paymentMethod: p.paymentMethod, securityDeposit: Number(p.securityDeposit) || 0, amountDue: 0,
    notes: '', createdAt: '', updatedAt: '',
  };
}

function InvoiceScreen() {
  const invoices = useInvoices();
  const crm = useCrmData();
  const issueM = useIssueInvoice();
  const canReportPayment = useInvoicePermission('invoices.report_payment');

  const [view, setView] = useState<'list' | 'form'>('list');
  const [editing, setEditing] = useState<InvoiceDto | null>(null);
  const [initialQuotationId, setInitialQuotationId] = useState('');
  const [quotationFilter, setQuotationFilter] = useState<{ id: string; number: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceDto | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<InvoiceDto | null>(null);
  const [listError, setListError] = useState<unknown>(null);

  // Prefill from the CRM plugin ("Proceed to invoicing" on a Won quotation).
  const location = useLocation();
  const prefilled = useRef(false);
  useEffect(() => {
    const pre = (location.state as { prefill?: { quotationId?: string } } | null)?.prefill;
    if (!pre || prefilled.current) return;
    prefilled.current = true;
    setEditing(null);
    setInitialQuotationId(pre.quotationId ?? '');
    setView('form');
    window.history.replaceState({}, '');
  }, [location.state]);

  const data = invoices.data ?? [];
  // The latest active invoice of each quotation: the only one that can be cancelled or recomputed.
  const latestByQuotation = useMemo(() => {
    const m = new Map<string, InvoiceDto>();
    for (const i of data) {
      if (i.status === 'Cancelled') continue;
      const cur = m.get(i.quotationId);
      if (!cur || i.sequenceNo > cur.sequenceNo) m.set(i.quotationId, i);
    }
    return m;
  }, [data]);

  const issue = (r: InvoiceDto) => {
    if (!window.confirm(`Issue invoice ${r.invoiceNo}? An issued invoice cannot be edited or cancelled.`)) return;
    setListError(null);
    issueM.mutate({ id: r.id, rowVersion: r.rowVersion }, {
      onSuccess: () => toastSuccess('Invoice issued'),
      onError: (e) => { setListError(e); toastError(errorText(e)); },
    });
  };

  const reloadList = () => { setListError(null); void invoices.refetch(); };

  if (view === 'form') {
    return (
      <InvoiceForm
        editing={editing}
        initialQuotationId={initialQuotationId}
        quotations={(crm.data?.quotations ?? []).filter((q) => q.phase === 'Won')}
        agreements={crm.data?.agreements ?? []}
        onBack={() => { setView('list'); setEditing(null); setInitialQuotationId(''); }}
      />
    );
  }

  const cols: Column<InvoiceDto>[] = [
    { key: 'invoiceNo', header: 'Invoice No.', sortable: true,
      render: (r) => <span className="font-mono text-xs font-semibold">{r.invoiceNo}</span> },
    { key: 'invoiceDate', header: 'Date', sortable: true },
    { key: 'customerId', header: 'Customer', sortable: true, sortAccessor: (r) => text(r.customerSnapshot.name),
      render: (r) => <span className="font-medium">{text(r.customerSnapshot.name)}</span> },
    { key: 'agreementNo', header: 'Hire Agreement', sortable: true },
    { key: 'quotationNo', header: 'Quotation', sortable: true,
      render: (r) => (
        <button type="button" className="font-mono text-xs text-blue-700 underline-offset-2 hover:underline"
          title="Show invoices of this quotation"
          onClick={(e) => { e.stopPropagation(); setQuotationFilter({ id: r.quotationId, number: r.quotationNo }); }}>
          {r.quotationNo}
        </button>
      ) },
    { key: 'invoiceType', header: 'Type', sortable: true },
    { key: 'periodStart', header: 'Billing period',
      render: (r) => <span className="whitespace-nowrap text-xs tabular-nums">{r.periodStart} – {r.periodEnd}</span> },
    { key: 'totalAmount', header: 'Total', sortable: true, sortAccessor: (r) => Number(r.totalAmount),
      render: (r) => <span className="font-semibold tabular-nums">{r.currencyCode} {money(Number(r.totalAmount))}</span> },
    { key: 'amountDue', header: 'Amount due', sortable: true, sortAccessor: (r) => Number(r.amountDue),
      render: (r) => <span className="tabular-nums">{money(Number(r.amountDue))}</span> },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <StatusBadge status={r.status} size="sm" /> },
    { key: 'id', header: '', width: '220px',
      render: (r) => {
        const isDraft = r.status === 'Draft';
        const isLatest = latestByQuotation.get(r.quotationId)?.id === r.id;
        return (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); setEditing(r); setView('form'); }}>{isDraft ? 'Edit' : 'View'}</Button>
            {isDraft && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={issueM.isPending}
                onClick={(e) => { e.stopPropagation(); issue(r); }}>Issue</Button>
            )}
            {isDraft && isLatest && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); setCancelTarget(r); }}>Cancel</Button>
            )}
            {canReportPayment && (r.status === 'Sent' || r.status === 'Paid' || r.status === 'Overdue') && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); setPaymentTarget(r); }}>Payment</Button>
            )}
          </div>
        );
      } },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoices"
        description="Create, issue and download tax invoices for Won quotations"
        actions={<Button size="sm" onClick={() => { setEditing(null); setInitialQuotationId(''); setView('form'); }}><Plus className="mr-1.5 h-4 w-4" /> New Invoice</Button>}
      />
      {quotationFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing invoices of quotation</span>
          <span className="font-mono text-xs font-semibold">{quotationFilter.number}</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setQuotationFilter(null)}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear filter
          </Button>
        </div>
      )}
      {invoices.isError && <ApiErrorNotice error={invoices.error} onRetry={() => void invoices.refetch()} />}
      {listError != null && <ApiErrorNotice error={listError} onReload={reloadList} />}
      {invoices.isLoading && <LoadingState />}
      {invoices.data && (
        <DataTable<InvoiceDto>
          columns={cols}
          data={data.filter((i) => !quotationFilter || i.quotationId === quotationFilter.id)}
          searchable
          searchPlaceholder="Search invoices…"
          searchKeys={['invoiceNo', 'agreementNo', 'quotationNo', 'status']}
          initialSort={{ key: 'invoiceNo', direction: 'desc' }}
          onRowClick={(r) => { setEditing(r); setView('form'); }}
          rowKey={(r) => r.id}
          pageSize={10}
          emptyMessage="No invoices yet. Click 'New Invoice' to create one."
        />
      )}
      <CancelInvoiceDialog invoice={cancelTarget} onClose={() => setCancelTarget(null)} />
      <PaymentStatusDialog invoice={paymentTarget} onClose={() => setPaymentTarget(null)} />
    </div>
  );
}

interface FormProps {
  editing: InvoiceDto | null;
  initialQuotationId: string;
  quotations: { id: string; number: string; customerName: string }[];
  agreements: { quotationId?: string; agreementNo: string; status: string }[];
  onBack: () => void;
}

function InvoiceForm({ editing, initialQuotationId, quotations, agreements, onBack }: FormProps) {
  const createM = useCreateInvoice();
  const updateM = useUpdateInvoice();
  const submission = useSubmission();
  const canRepeatTransport = useInvoicePermission('invoices.transport_repeat');
  const orgId = browserOrgId();

  const isNew = !editing;
  const [current, setCurrent] = useState<InvoiceDto | null>(editing);
  const [quotationId, setQuotationId] = useState(initialQuotationId);
  const [invoiceType, setInvoiceType] = useState<InvoiceTypeValue>('Continuous Hire');
  const [form, setForm] = useState<FormState>(editing ? formFromInvoice(editing) : EMPTY_FORM);
  const [error, setError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);

  const prefill = useInvoicePrefill(isNew ? quotationId : '', invoiceType);
  const p = isNew ? prefill.data : undefined;

  // A new prefill (quotation or type changed) resets the form to the server's suggestions.
  const prefillKey = p ? `${p.quotationId}|${p.invoiceType}|${p.periodStart}` : '';
  useEffect(() => {
    if (p) { setForm(formFromPrefill(p)); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  /** Quantity or rate changes recompute the suggested amount and require the charge to be confirmed again. */
  const setEquipment = (key: 'quantity' | 'unitRate' | 'amount', value: string) =>
    setForm((f) => {
      const next = { ...f, [key]: value, chargeConfirmed: false };
      if (key !== 'amount') next.amount = to2((Number(next.quantity) || 0) * (Number(next.unitRate) || 0));
      return next;
    });

  const isDraft = isNew || current?.status === 'Draft';
  const original = current ? formFromInvoice(current) : null;
  const equipmentChanged = !isNew && !!original
    && (Number(form.quantity) !== Number(original.quantity) || Number(form.unitRate) !== Number(original.unitRate)
      || Number(form.amount) !== Number(original.amount));
  const transportChanged = !isNew && !!original && Number(form.transport) !== Number(original.transport);

  // Repeat transport: after the first active invoice a charge above 0 needs a privileged confirmation.
  const repeatTransport = isNew
    ? !!p?.transport.repeatRequiresConfirmation && Number(form.transport) > 0
    : transportChanged && Number(form.transport) > 0 && (current?.sequenceNo ?? 1) > 1;
  const chargeNeedsConfirm = isNew || equipmentChanged;

  const view: TaxInvoice | null = useMemo(() => {
    const base = isNew ? (p ? viewFromPrefill(p, orgId) : null) : current ? invoiceFromDto(current, orgId) : null;
    if (!base) return null;
    if (!isDraft) return base;
    const vatRate = Number(isNew ? p?.vatRate : current?.vatRate) || 0;
    const eq = Number(form.amount) || 0;
    const tr = Number(form.transport) || 0;
    const subtotal = eq + tr;
    const vat = Math.round(subtotal * vatRate * 100) / 100;
    return {
      ...base,
      invoiceDate: form.invoiceDate || base.invoiceDate,
      periodEnd: form.periodEnd || base.periodEnd,
      hirePeriod: `${base.periodStart ?? ''} – ${form.periodEnd || base.periodEnd || ''}`,
      equipmentQty: Number(form.quantity) || 0, equipmentRate: Number(form.unitRate) || 0, equipmentAmount: eq,
      transportationQty: 1, transportationRate: tr, transportationAmount: tr,
      subtotal, vat, totalAmount: subtotal + vat, amountDue: subtotal + vat,
      notes: form.notes,
    };
  }, [isNew, p, current, form, isDraft, orgId]);

  const vatLabel = `${(Number(isNew ? p?.vatRate : current?.vatRate) * 100 || 0).toString()}%`;
  const fieldErrors = error ? describeApiError(error).fieldErrors : {};

  const blocked = isNew
    ? !p || prefill.isFetching || (chargeNeedsConfirm && !form.chargeConfirmed) || (repeatTransport && (!form.repeatConfirmed || !canRepeatTransport))
    : isDraft && ((equipmentChanged && !form.chargeConfirmed) || (repeatTransport && (!form.repeatConfirmed || !canRepeatTransport)));
  const saving = createM.isPending || updateM.isPending;

  const save = async () => {
    setError(null);
    try {
      if (isNew) {
        if (!p) return;
        await createM.mutateAsync({
          submissionId: submission.id(),
          body: {
            quotationId: p.quotationId,
            hireAgreementId: p.hireAgreementId,
            invoiceType: p.invoiceType,
            periodStart: p.periodStart,
            ...(p.invoiceType === 'Continuous Hire' ? { periodEnd: form.periodEnd } : {}),
            invoiceDate: form.invoiceDate || undefined,
            equipment: { quantity: form.quantity, unitRate: form.unitRate, amount: form.amount },
            periodChargeConfirmed: true,
            transport: { amount: form.transport || '0.00' },
            ...(repeatTransport ? { repeatTransportConfirmed: true } : {}),
            notes: form.notes.trim() || null,
          },
        });
        submission.renew();
        toastSuccess('Invoice created');
      } else if (current) {
        const patch: InvoiceUpdateDto = {};
        if (isDraft && equipmentChanged) {
          patch.equipment = { quantity: form.quantity, unitRate: form.unitRate, amount: form.amount };
          patch.periodChargeConfirmed = true;
        }
        if (isDraft && transportChanged) {
          patch.transport = { amount: form.transport || '0.00' };
          if (repeatTransport) patch.repeatTransportConfirmed = true;
        }
        if (isDraft && form.invoiceDate !== current.invoiceDate) patch.invoiceDate = form.invoiceDate;
        if (form.notes !== (current.notes ?? '')) patch.notes = form.notes.trim() || null;
        if (Object.keys(patch).length === 0) { onBack(); return; }
        await updateM.mutateAsync({ id: current.id, rowVersion: current.rowVersion, patch });
        toastSuccess('Invoice saved');
      }
      onBack();
    } catch (err) {
      setError(err); // the form keeps every entered value
    }
  };

  /** 409: take the latest row version without touching what the user entered. */
  const reload = async () => {
    if (!current) return;
    setReloading(true);
    try {
      setCurrent(await fetchInvoice(current.id));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const download = () => setTimeout(() => window.print(), 100);
  const agreementNo = p?.agreementNo
    ?? agreements.find((a) => a.quotationId === quotationId && a.status !== 'Cancelled')?.agreementNo ?? '—';
  const f = view;
  const issuer = f?.issuerName || 'Your Company';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to List</Button>
        <span className="text-sm text-muted-foreground">
          {editing ? `${isDraft ? 'Editing' : 'Viewing'} ${current?.invoiceNo}` : 'New Invoice'}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={download} disabled={!f}><Download className="mr-1.5 h-4 w-4" /> Download / Print</Button>
          <Button size="sm" onClick={() => void save()} disabled={blocked || saving || !f}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>

      {error != null && <ApiErrorNotice className="mx-auto max-w-4xl print:hidden" error={error} onReload={() => void reload()} reloading={reloading} />}

      {isNew && (
        <div className="mx-auto max-w-4xl space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-4 text-sm print:hidden">
          <h2 className="text-sm font-bold uppercase text-blue-900">Create from Won quotation</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-gray-600">Won quotation</span>
              <select className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" aria-label="Won quotation"
                value={quotationId} onChange={(e) => setQuotationId(e.target.value)}>
                <option value="">— Choose a Won quotation —</option>
                {quotations.map((q) => <option key={q.id} value={q.id}>{q.number} — {q.customerName}</option>)}
              </select>
            </label>
            <fieldset className="space-y-1">
              <legend className="text-xs text-gray-600">Invoice type</legend>
              <div className="flex gap-4 pt-1.5">
                {(['Continuous Hire', 'Off-Hire'] as InvoiceTypeValue[]).map((t) => (
                  <label key={t} className="flex items-center gap-1.5">
                    <input type="radio" name="invoice-type" value={t} checked={invoiceType === t} onChange={() => setInvoiceType(t)} />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {quotationId && prefill.isError && <ApiErrorNotice error={prefill.error} />}
          {quotationId && prefill.isFetching && <p className="text-xs text-muted-foreground">Loading the agreement and billing period…</p>}
          {p && (
            <div className="grid gap-3 text-xs sm:grid-cols-4">
              <div><span className="block text-gray-600">Hire agreement</span><span className="font-medium">{agreementNo}</span></div>
              <div><span className="block text-gray-600">Hire dates</span><span className="font-medium">{p.hireStartDate} – {p.hireEndDate}</span></div>
              <div><span className="block text-gray-600">Period start</span><span className="font-medium">{p.periodStart}</span></div>
              <div><span className="block text-gray-600">Period end</span>
                {p.invoiceType === 'Continuous Hire' ? (
                  <input type="date" className={inp} aria-label="Period end" value={form.periodEnd}
                    min={p.periodStart} max={p.hireEndDate} onChange={(e) => set('periodEnd', e.target.value)} />
                ) : (
                  <span className="font-medium">{p.periodEnd ?? p.hireEndDate} <span className="text-gray-400">(hire end date)</span></span>
                )}
              </div>
            </div>
          )}
          {fieldErrors.periodStart && <p className="text-xs text-rose-600" role="alert">periodStart: {fieldErrors.periodStart}</p>}
        </div>
      )}

      {(isNew ? !!p : !!current) && (
        <div className="mx-auto max-w-4xl space-y-3 rounded-md border border-gray-200 bg-white p-4 text-sm print:hidden">
          <h2 className="text-sm font-bold uppercase text-blue-900">
            {isDraft ? 'Charges' : 'Notes'}
          </h2>
          {!isDraft && (
            <p className="text-xs text-muted-foreground">
              This invoice is {current?.status}. Financial fields are locked; only the notes can be changed.
              {current?.status !== 'Cancelled' && ' Payment status comes from the accounting system and is reported from the list.'}
            </p>
          )}
          {isDraft && (
            <>
              {!isNew && (
                <p className="text-xs text-muted-foreground">
                  Financial changes apply to the latest Draft invoice of the quotation only. Totals are recalculated by the server.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="space-y-1"><span className="text-xs text-gray-600">Invoice date</span>
                  <input type="date" className={`${inp} w-full`} aria-label="Invoice date" value={form.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-600">Equipment quantity</span>
                  <input type="number" min={0} step="1" className={`${inp} w-full`} aria-label="Equipment quantity" value={form.quantity} onChange={(e) => setEquipment('quantity', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-600">Equipment rate</span>
                  <input type="number" min={0} step="0.01" className={`${inp} w-full`} aria-label="Equipment rate" value={form.unitRate} onChange={(e) => setEquipment('unitRate', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-xs text-gray-600">Period charge (amount)</span>
                  <input type="number" min={0} step="0.01" className={`${inp} w-full`} aria-label="Period charge" value={form.amount} onChange={(e) => setEquipment('amount', e.target.value)} /></label>
              </div>
              {fieldErrors['equipment.quantity'] && <p className="text-xs text-rose-600">{fieldErrors['equipment.quantity']}</p>}
              {chargeNeedsConfirm && (
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={form.chargeConfirmed} onChange={(e) => set('chargeConfirmed', e.target.checked)} />
                  <span>I confirm the period charge. The amount is entered by me and is not prorated automatically.</span>
                </label>
              )}
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="space-y-1"><span className="text-xs text-gray-600">Transportation charge</span>
                  <input type="number" min={0} step="0.01" className={`${inp} w-full`} aria-label="Transportation charge" value={form.transport}
                    onChange={(e) => setForm((x) => ({ ...x, transport: e.target.value, repeatConfirmed: false }))} /></label>
              </div>
              {isNew && p?.transport.repeatRequiresConfirmation && Number(form.transport) <= 0 && (
                <p className="text-xs text-muted-foreground">Transportation is 0 because this quotation already has an active invoice.</p>
              )}
              {repeatTransport && (
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={form.repeatConfirmed} disabled={!canRepeatTransport}
                    onChange={(e) => set('repeatConfirmed', e.target.checked)} />
                  <span>
                    I confirm this repeat transportation charge.
                    {!canRepeatTransport && <span className="text-amber-700"> You do not have permission to confirm it; set the charge to 0.</span>}
                  </span>
                </label>
              )}
            </>
          )}
          <label className="block space-y-1"><span className="text-xs text-gray-600">Notes</span>
            <textarea rows={2} className="w-full rounded border border-gray-300 p-2 text-xs" aria-label="Notes" value={form.notes}
              disabled={current?.status === 'Cancelled'} onChange={(e) => set('notes', e.target.value)} /></label>
          {current?.status === 'Cancelled' && current.cancellationReason && (
            <p className="text-xs text-rose-700">Cancelled: {current.cancellationReason}</p>
          )}
        </div>
      )}

      {f ? <InvoiceDocument f={f} vatLabel={vatLabel} issuer={issuer} newInvoice={isNew} /> : (
        isNew && !prefill.isError && <p className="mx-auto max-w-4xl text-sm text-muted-foreground print:hidden">Choose a Won quotation to prepare the invoice.</p>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print, #invoice-print * { visibility: visible !important; }
          #invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}

/** The printable tax invoice. Read-only: every value is the server's or the confirmed form value. */
function InvoiceDocument({ f, vatLabel, issuer, newInvoice }: { f: TaxInvoice; vatLabel: string; issuer: string; newInvoice: boolean }) {
  return (
    <div id="invoice-print" className="mx-auto max-w-4xl bg-white text-gray-900 shadow-lg print:max-w-none print:shadow-none"
      style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px' }}>
      <div className="flex items-stretch justify-between border border-blue-900">
        <div className="w-1/2 bg-blue-50 p-5">
          <div className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-blue-900"><FileText className="h-4 w-4" /> {issuer}</div>
          <div className="space-y-1 text-xs text-gray-600">
            <p>{f.issuerAddress}</p>
            <p>{[f.issuerPhone, f.issuerEmail].filter(Boolean).join(' | ')}</p>
            <p>{[f.issuerTradeLicense && `Trade License: ${f.issuerTradeLicense}`, f.issuerTrn && `TRN: ${f.issuerTrn}`].filter(Boolean).join(' | ')}</p>
          </div>
        </div>
        <div className="w-1/2 p-5 text-right">
          <h1 className="text-3xl font-extrabold uppercase text-blue-900">Tax Invoice</h1>
          <div className="mt-3 space-y-1 text-xs">
            <p><b>Invoice No.:</b> {newInvoice ? <span className="text-gray-400">Assigned on save</span> : f.invoiceNo}</p>
            <p><b>Invoice Date:</b> {f.invoiceDate}</p>
            <p><b>Due Date:</b> {f.dueDate}</p>
            <p><b>Currency:</b> {f.currency}</p>
            <p><b>Status:</b> {f.status}</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <section>
          <h2 className={h2}>Invoice Details</h2>
          <table className="w-full border border-gray-200 text-xs">
            <tbody>
              <tr>
                <td className={lab}>Hire Agreement No.</td><td className={cell}>{f.hireAgreementNo}</td>
                <td className={lab}>Quotation</td><td className={cell}>{f.quotationNumber ?? ''}</td>
              </tr>
              <tr>
                <td className={lab}>Invoice Type</td><td className={cell}>{f.invoiceType}</td>
                <td className={lab}>Billing Period</td><td className={cell}>{f.periodStart} – {f.periodEnd}</td>
              </tr>
              <tr>
                <td className={lab}>Delivery Location</td><td className={cell}>{f.deliveryLocation}</td>
                <td className={lab}>Payment Terms</td><td className={cell}>{f.paymentTerms}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className={h2}>Bill To</h2>
          <table className="w-full border border-gray-200 text-xs">
            <tbody>
              <tr><td className={lab}>Customer Name</td><td className={cell}>{f.customerName}</td><td className={lab}>Customer ID</td><td className={cell}>{f.customerId}</td></tr>
              <tr><td className={lab}>Customer TRN</td><td className={cell}>{f.customerTrn}</td><td className={lab}>Attn</td><td className={cell}>{f.attn}</td></tr>
              <tr><td className={lab}>Contact</td><td className={cell}>{f.contactNumber}</td><td className={lab}>Email</td><td className={cell}>{f.customerEmail}</td></tr>
              <tr><td className={lab}>Billing Address</td><td className={cell} colSpan={3}>{f.billingAddress}</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className={h2}>Items / Services</h2>
          <table className="w-full border border-gray-200 text-xs">
            <thead>
              <tr className="bg-blue-50 text-blue-900">
                <th className={`${cell} w-8 text-left`}>#</th>
                <th className={`${cell} text-left`}>Description</th>
                <th className={`${cell} w-16 text-left`}>Qty</th>
                <th className={`${cell} w-28 text-left`}>Rate ({f.currency})</th>
                <th className={`${cell} w-28 text-left`}>Amount ({f.currency})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cell}>1</td><td className={cell}>{f.equipmentDescription}</td>
                <td className={cell}>{f.equipmentQty}</td><td className={cell}>{money(f.equipmentRate)}</td><td className={cell}>{money(f.equipmentAmount)}</td>
              </tr>
              <tr>
                <td className={cell}>2</td><td className={cell}>Transportation Charges</td>
                <td className={cell}>{f.transportationQty}</td><td className={cell}>{money(f.transportationRate)}</td><td className={cell}>{money(f.transportationAmount)}</td>
              </tr>
            </tbody>
          </table>
          <table className="ml-auto mt-3 w-72 border border-gray-200 text-xs">
            <tbody>
              <tr><td className={cell}>Subtotal</td><td className={`${cell} text-right`}>{f.currency} {money(f.subtotal)}</td></tr>
              <tr><td className={cell}>VAT @ {vatLabel}</td><td className={`${cell} text-right`}>{f.currency} {money(f.vat)}</td></tr>
              <tr className="bg-blue-50 font-bold text-blue-900"><td className={cell}>TOTAL INCL. VAT</td><td className={`${cell} text-right`}>{f.currency} {money(f.totalAmount)}</td></tr>
            </tbody>
          </table>
          {newInvoice && <p className="mt-1 text-right text-[10px] text-gray-400 print:hidden">Totals are recalculated by the server when you save.</p>}
        </section>

        <section>
          <h2 className={h2}>Payment Information</h2>
          <table className="w-full border border-gray-200 text-xs">
            <tbody>
              <tr>
                <td className={lab}>Payment Method</td><td className={cell}>{f.paymentMethod}</td>
                <td className={lab}>Security Deposit</td><td className={cell}>{money(f.securityDeposit)}<span className="text-gray-400"> (not included above)</span></td>
              </tr>
              <tr>
                <td className={lab}>Amount Due</td><td className={cell}>{f.currency} {money(f.amountDue)}</td>
                <td className={lab}>Due Date</td><td className={cell}>{f.dueDate}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {f.notes && (
          <section>
            <h2 className={h2}>Notes</h2>
            <p className="whitespace-pre-wrap border border-gray-200 p-2 text-xs">{f.notes}</p>
          </section>
        )}

        <table className="w-full border border-blue-900 text-xs">
          <thead>
            <tr className="bg-blue-50 text-blue-900">
              <th className={`${cell} w-1/2 text-left`}>FOR {issuer.toUpperCase()}</th>
              <th className={`${cell} w-1/2 text-left`}>CUSTOMER ACKNOWLEDGEMENT – {(f.customerName || 'CUSTOMER').toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="space-y-3 p-3"><p>Authorized Signature: ______________________</p><p>Name: _________________________________</p><p>Company Stamp:</p></td>
              <td className="space-y-3 p-3"><p>Received By: _____________________________</p><p>Signature: ______________________________</p><p>Date: __________________________________</p></td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs font-bold">Thank you for your business.</p>
      </div>

      <div className="flex justify-between border-t border-gray-300 px-6 py-2 text-[10px] text-gray-400">
        <span>{issuer} | TAX INVOICE</span><span>Page 1</span>
      </div>
    </div>
  );
}
