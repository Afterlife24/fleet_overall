import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/common/EmptyState';
import {
  useTaxInvoices, useCreateTaxInvoice, useUpdateTaxInvoice, useDeleteTaxInvoice,
  useHireAgreements, useCustomerANIs,
} from '@/hooks/useQueries';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import type { TaxInvoice } from '@/types/taxinvoice';
import type { HireAgreement } from '@/types/hireagreement';
import type { CustomerANI } from '@/types/customerani';
import { Plus, Download, ArrowLeft, FileText, Trash2, X } from 'lucide-react';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { InvoiceRuleError, listWonQuotations, previewInvoice, previewRevision } from '@/services/quotationInvoicing';
import { RULE_MESSAGES, addDays, recalcTotals } from '@/services/invoiceRulesCore';
import type { InvoiceType } from '@/types/taxinvoice';

const money = (n: number) =>
  (n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof InvoiceRuleError ? (RULE_MESSAGES[e.code] ?? e.message) : fallback;

function recalc(f: Partial<TaxInvoice>): Partial<TaxInvoice> {
  return recalcTotals(f);
}

type Org = {
  name?: string; tradeLicense?: string; companyTrn?: string;
  companyAddress?: string; companyPhone?: string; companyEmail?: string;
} | undefined;

function emptyInvoice(org: Org, seq: number): Partial<TaxInvoice> {
  const today = new Date().toISOString().slice(0, 10);
  const no = `INV-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`;
  return recalc({
    invoiceNo: no, invoiceDate: today, dueDate: addDays(today, 30), currency: 'AED', status: 'Draft',
    issuerName: org?.name ?? '', issuerAddress: org?.companyAddress ?? '',
    issuerPhone: org?.companyPhone ?? '', issuerEmail: org?.companyEmail ?? '',
    issuerTradeLicense: org?.tradeLicense ?? '', issuerTrn: org?.companyTrn ?? '',
    customerId: '', customerName: '', customerTrn: '', attn: '', contactNumber: '',
    customerEmail: '', billingAddress: '',
    hireAgreementNo: '', hirePeriod: '', deliveryLocation: '', paymentTerms: '30 Days',
    equipmentDescription: '', equipmentQty: 1, equipmentRate: 0,
    transportationQty: 1, transportationRate: 0,
    paymentMethod: 'Bank Transfer', securityDeposit: 0,
    notes: `Please mention invoice number ${no} when making payment. This invoice covers the equipment hire and transportation charges listed above.`,
  });
}

const cell = 'border border-gray-200 px-3 py-1.5';
const lab = `${cell} text-gray-600 w-40`;
const inp = 'w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none';

export function InvoicePage() {
  const { data: invoices, isLoading, isError, refetch } = useTaxInvoices();
  const { data: agreements } = useHireAgreements();
  const { data: customers } = useCustomerANIs();
  const createM = useCreateTaxInvoice();
  const updateM = useUpdateTaxInvoice();
  const deleteM = useDeleteTaxInvoice();

  const user = useAuthStore((s) => s.user);
  const getOrg = useOrgStore((s) => s.getOrg);
  const org = user ? getOrg(user.orgId) : undefined;

  const [view, setView] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<TaxInvoice>>({});

  // Create-from-quotation state (new invoices only)
  const [quotationId, setQuotationId] = useState('');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('Continuous Hire');
  const [periodEnd, setPeriodEnd] = useState('');
  const [oldPrefill, setOldPrefill] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [agreementNote, setAgreementNote] = useState('');
  // List filter by quotation
  const [quotationFilter, setQuotationFilter] = useState<{ id: string; number: string } | null>(null);

  const newMode = view === 'form' && !editId;

  const set = <K extends keyof TaxInvoice>(key: K, val: TaxInvoice[K]) =>
    setForm((p) => recalc({ ...p, [key]: val }));

  const resetCreateState = () => {
    setQuotationId(''); setInvoiceType('Continuous Hire'); setPeriodEnd('');
    setOldPrefill(false); setSaveError(''); setAgreementNote('');
  };

  const openNew = () => {
    resetCreateState();
    setForm(emptyInvoice(org, ((invoices as TaxInvoice[] | undefined)?.length ?? 0) + 1));
    setEditId(null);
    setView('form');
  };

  const wonQuotations = useMemo(
    () => (view === 'form' ? listWonQuotations() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, invoices],
  );

  const preview = useMemo(
    () => (newMode && quotationId
      ? previewInvoice({
          quotationId,
          invoiceType,
          periodEnd: invoiceType === 'Continuous Hire' ? periodEnd || undefined : undefined,
        })
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newMode, quotationId, invoiceType, periodEnd, invoices],
  );

  // Agreement used as the default for the end date and to fill the display fields.
  const quotationAgreement = useMemo(
    () => (quotationId
      ? (agreements as (HireAgreement & { quotationId?: string })[] | undefined)
          ?.find((a) => a.quotationId === quotationId && a.status !== 'Cancelled')
      : undefined),
    [agreements, quotationId],
  );

  // Continuous Hire bills monthly: the end date defaults to one month after the period start.
  useEffect(() => {
    if (newMode && invoiceType === 'Continuous Hire' && !periodEnd && preview?.ok && preview.periodEnd) {
      setPeriodEnd(preview.periodEnd);
    }
  }, [newMode, invoiceType, periodEnd, preview]);

  // Fill the form from the previewed agreement and period.
  const fillKey = preview?.ok
    ? `${preview.agreementNo}|${preview.periodStart}|${preview.periodEnd}|${preview.invoiceNo}|${quotationAgreement?.id ?? ''}`
    : '';
  useEffect(() => {
    if (!newMode || !preview?.ok || !quotationAgreement) return;
    const h = quotationAgreement;
    const cust = (customers as CustomerANI[] | undefined)?.find((c) => c.customerId === h.customerId);
    const terms = parseInt(h.paymentTerms, 10) || 30;
    setForm((p) => recalc({
      ...p,
      invoiceNo: preview.invoiceNo,
      hireAgreementNo: h.agreementNo,
      hirePeriod: `${preview.periodStart} – ${preview.periodEnd}`,
      deliveryLocation: h.deliveryLocation,
      paymentTerms: h.paymentTerms,
      dueDate: addDays(p.invoiceDate || h.hireStartDate, terms),
      customerId: h.customerId,
      customerName: h.customerName,
      customerTrn: h.customerTrn,
      attn: h.attn,
      contactNumber: h.contactNumber,
      customerEmail: h.customerEmail,
      billingAddress: cust?.billingAddress ?? h.billingAddress,
      equipmentDescription: `${h.equipmentModel} ${h.equipmentName} – Monthly Hire | Serial: ${h.serialNumber} | Working height: ${h.workingHeight} | Capacity: ${h.capacity}`,
      equipmentQty: 1,
      equipmentRate: h.monthlyRental,
      transportationQty: 1,
      transportationRate: h.transportationCharges,
      paymentMethod: h.paymentMethod,
      securityDeposit: h.securityDeposit,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillKey]);
  // Prefill from the CRM plugin ("Proceed to invoicing" on a Won quotation).
  const location = useLocation();
  const prefilled = useRef(false);
  useEffect(() => {
    const pre = (location.state as { prefill?: { quotationId?: string } } | null)?.prefill;
    if (!pre || prefilled.current) return;
    prefilled.current = true;
    resetCreateState();
    // Old prefill shape (no quotationId): the user must pick a Won quotation.
    if (pre.quotationId) setQuotationId(pre.quotationId); else setOldPrefill(true);
    setForm(emptyInvoice(org, ((invoices as TaxInvoice[] | undefined)?.length ?? 0) + 1));
    setEditId(null);
    setView('form');
    window.history.replaceState({}, '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);
  const openEdit = (r: TaxInvoice) => { resetCreateState(); setForm({ ...r }); setEditId(r.id); setView('form'); };

  // Hire Agreement No. dropdown: fills every detail of the invoice
  const pickAgreement = (no: string) => {
    const h = (agreements as HireAgreement[] | undefined)?.find((a) => a.agreementNo === no);
    if (!h) { set('hireAgreementNo', no); return; }
    const cust = (customers as CustomerANI[] | undefined)?.find((c) => c.customerId === h.customerId);
    const terms = parseInt(h.paymentTerms, 10) || 30;
    setForm((p) => recalc({
      ...p,
      hireAgreementNo: h.agreementNo,
      hirePeriod: `${h.hireStartDate} – ${h.hireEndDate}`,
      deliveryLocation: h.deliveryLocation,
      paymentTerms: h.paymentTerms,
      dueDate: addDays(p.invoiceDate || h.hireStartDate, terms),
      customerId: h.customerId,
      customerName: h.customerName,
      customerTrn: h.customerTrn,
      attn: h.attn,
      contactNumber: h.contactNumber,
      customerEmail: h.customerEmail,
      billingAddress: cust?.billingAddress ?? h.billingAddress,
      equipmentDescription: `${h.equipmentModel} ${h.equipmentName} – Monthly Hire | Serial: ${h.serialNumber} | Working height: ${h.workingHeight} | Capacity: ${h.capacity}`,
      equipmentQty: 1,
      equipmentRate: h.monthlyRental,
      transportationQty: 1,
      transportationRate: h.transportationCharges,
      paymentMethod: h.paymentMethod,
      securityDeposit: h.securityDeposit,
    }));
  };

  const save = async () => {
    setSaveError('');
    try {
      if (editId) {
        await updateM.mutateAsync({ id: editId, data: form });
        toastSuccess('Invoice saved');
      } else {
        await createM.mutateAsync({
          quotationId,
          invoiceType,
          periodEnd: invoiceType === 'Continuous Hire' ? periodEnd || undefined : undefined,
          edits: {
            invoiceDate: form.invoiceDate,
            currency: form.currency,
            notes: form.notes,
            equipmentDescription: form.equipmentDescription,
            equipmentQty: form.equipmentQty,
            equipmentRate: form.equipmentRate,
            transportationQty: form.transportationQty,
            transportationRate: form.transportationRate,
            paymentMethod: form.paymentMethod,
            securityDeposit: form.securityDeposit,
            billingAddress: form.billingAddress,
            dueDate: form.dueDate,
            deliveryLocation: form.deliveryLocation,
            paymentTerms: form.paymentTerms,
            customerTrn: form.customerTrn,
            attn: form.attn,
            contactNumber: form.contactNumber,
            customerEmail: form.customerEmail,
          },
        });
        toastSuccess('Invoice created');
      }
      setView('list');
    } catch (e) {
      const msg = errorMessage(e, 'Could not save invoice');
      setSaveError(msg);
      toastError(msg);
    }
  };

  // Editing an existing linked invoice: a changed type or end date is re-checked live.
  const original = editId ? ((invoices ?? []) as TaxInvoice[]).find((i) => i.id === editId) : undefined;
  const revisionChanged = !!original?.quotationId && !!editId
    && (form.invoiceType !== original.invoiceType || form.periodEnd !== original.periodEnd);
  const revision = useMemo(
    () => (revisionChanged && editId
      ? previewRevision(editId, { invoiceType: form.invoiceType, periodEnd: form.periodEnd })
      : null),
    [revisionChanged, editId, form.invoiceType, form.periodEnd],
  );
  // Off-Hire always ends on the hire end date: show it as soon as the type is switched.
  useEffect(() => {
    if (revision?.ok && revision.periodEnd && revision.periodEnd !== form.periodEnd) {
      setForm((p) => ({ ...p, periodEnd: revision.periodEnd, hirePeriod: `${revision.periodStart} – ${revision.periodEnd}` }));
    } else if (revision?.ok) {
      setForm((p) => ({ ...p, hirePeriod: `${revision.periodStart} – ${revision.periodEnd}` }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision?.ok, revision?.periodEnd]);

  const blockedByPreview = (newMode && !preview?.ok) || (!!revision && !revision.ok);
  const saveDisabled = createM.isPending || updateM.isPending || blockedByPreview;

  const cancelInvoice = (r: TaxInvoice) =>
    updateM.mutate({ id: r.id, data: { status: 'Cancelled' } }, {
      onSuccess: () => toastSuccess('Invoice cancelled'),
      onError: (e) => toastError(errorMessage(e, 'Could not cancel invoice')),
    });

  const download = () => setTimeout(() => window.print(), 100);

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (view === 'list') {
    const cols: Column<TaxInvoice>[] = [
      { key: 'invoiceNo', header: 'Invoice No.', sortable: true,
        render: (r) => <span className="font-mono text-xs font-semibold">{r.invoiceNo}</span> },
      { key: 'invoiceDate', header: 'Date', sortable: true },
      { key: 'customerName', header: 'Customer', sortable: true,
        render: (r) => <span className="font-medium">{r.customerName}</span> },
      { key: 'hireAgreementNo', header: 'Hire Agreement', sortable: true },
      { key: 'quotationNumber', header: 'Quotation', sortable: true,
        sortAccessor: (r) => r.quotationNumber ?? '',
        render: (r) => r.quotationId && r.quotationNumber ? (
          <button type="button" className="font-mono text-xs text-blue-700 underline-offset-2 hover:underline"
            title="Show invoices of this quotation"
            onClick={(e) => { e.stopPropagation(); setQuotationFilter({ id: r.quotationId!, number: r.quotationNumber! }); }}>
            {r.quotationNumber}
          </button>
        ) : null },
      { key: 'invoiceType', header: 'Type', sortable: true,
        sortAccessor: (r) => r.invoiceType ?? '',
        render: (r) => <span>{r.invoiceType ?? ''}</span> },
      { key: 'periodStart', header: 'Billing period',
        render: (r) => r.periodStart && r.periodEnd
          ? <span className="whitespace-nowrap text-xs tabular-nums">{r.periodStart} – {r.periodEnd}</span>
          : null },
      { key: 'totalAmount', header: 'Total (AED)', sortable: true, sortAccessor: (r) => r.totalAmount,
        render: (r) => <span className="font-semibold tabular-nums">AED {money(r.totalAmount)}</span> },
      { key: 'status', header: 'Status', sortable: true,
        render: (r) => <StatusBadge status={r.status} size="sm" /> },
      { key: 'id', header: '', width: '140px',
        render: (r) => (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</Button>
            {r.quotationId && r.status !== 'Cancelled' && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={(e) => { e.stopPropagation(); cancelInvoice(r); }}>Cancel</Button>
            )}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-600"
              onClick={(e) => {
                e.stopPropagation();
                deleteM.mutate(r.id, {
                  onSuccess: () => toastSuccess('Invoice deleted'),
                  onError: (err) => toastError(errorMessage(err, 'Could not delete invoice')),
                });
              }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) },
    ];
    return (
      <div className="space-y-5">
        <PageHeader
          title="Invoices"
          description="Create, manage and download tax invoices"
          actions={<Button size="sm" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" /> New Invoice</Button>}
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
        {isLoading ? <LoadingState /> : (
          <DataTable<TaxInvoice>
            columns={cols}
            data={((invoices ?? []) as TaxInvoice[]).filter((i) => !quotationFilter || i.quotationId === quotationFilter.id)}
            searchable
            searchPlaceholder="Search invoices…"
            searchKeys={['invoiceNo', 'customerName', 'hireAgreementNo', 'quotationNumber', 'status']}
            initialSort={{ key: 'invoiceNo', direction: 'desc' }}
            onRowClick={openEdit}
            rowKey={(r) => r.id}
            pageSize={10}
            emptyMessage="No invoices yet. Click 'New Invoice' to create one."
          />
        )}
      </div>
    );
  }

  const f = form as TaxInvoice;
  // New invoices are always created from a quotation; only legacy invoices are free-text.
  const isLinked = newMode || !!f.quotationId;
  const linkedExisting = !newMode && !!f.quotationId;
  const agreementList = ((agreements ?? []) as HireAgreement[]).filter((a) => a.status !== 'Cancelled');
  const wonIds = new Set(wonQuotations.map((q) => q.id));
  // New invoice: picking the hire agreement fills the form and selects its Won quotation.
  const pickAgreementForNew = (no: string) => {
    pickAgreement(no);
    setPeriodEnd('');
    setOldPrefill(false);
    const h = agreementList.find((a) => a.agreementNo === no);
    if (h?.quotationId && wonIds.has(h.quotationId)) {
      setQuotationId(h.quotationId);
      setAgreementNote('');
    } else {
      setQuotationId('');
      setAgreementNote(!h ? '' : h.quotationId
        ? 'The quotation of this hire agreement is not Won yet, so it cannot be invoiced.'
        : 'This hire agreement is not linked to a quotation, so it cannot be invoiced.');
    }
  };
  const setLegacyPeriod = (start?: string, end?: string) =>
    setForm((p) => ({ ...p, periodStart: start, periodEnd: end, hirePeriod: start && end ? `${start} – ${end}` : p.hirePeriod }));
  const issuer = f.issuerName || org?.name || 'Your Company';
  const text = (key: keyof TaxInvoice, placeholder?: string) => (
    <input className={inp} value={String(f[key] ?? '')} placeholder={placeholder}
      onChange={(e) => set(key, e.target.value as TaxInvoice[typeof key])} />
  );
  const num = (key: keyof TaxInvoice, right = false) => (
    <input type="number" className={`${inp} ${right ? 'text-right' : ''}`} value={Number(f[key] ?? 0)}
      onChange={(e) => set(key, Number(e.target.value) as TaxInvoice[typeof key])} />
  );
  const h2 = 'mb-2 text-sm font-bold uppercase text-blue-900';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="outline" size="sm" onClick={() => setView('list')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to List
        </Button>
        <span className="text-sm text-muted-foreground">{editId ? `Editing ${f.invoiceNo}` : 'New Invoice'}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-4 w-4" /> Download / Print</Button>
          <Button size="sm" onClick={save} disabled={saveDisabled}>Save</Button>
        </div>
      </div>

      {newMode && (
        <div className="mx-auto max-w-4xl space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-4 text-sm print:hidden">
          <h2 className="text-sm font-bold uppercase text-blue-900">Create from Won quotation</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-gray-600">Won quotation</span>
              <select className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                value={quotationId}
                onChange={(e) => { setQuotationId(e.target.value); setPeriodEnd(''); setOldPrefill(false); }}>
                <option value="">— Choose a Won quotation —</option>
                {wonQuotations.map((q) => (
                  <option key={q.id} value={q.id}>{q.number} — {q.customerName}</option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-1">
              <legend className="text-xs text-gray-600">Invoice type</legend>
              <div className="flex gap-4 pt-1.5">
                {(['Continuous Hire', 'Off-Hire'] as InvoiceType[]).map((t) => (
                  <label key={t} className="flex items-center gap-1.5">
                    <input type="radio" name="invoice-type" value={t} checked={invoiceType === t}
                      onChange={() => { setInvoiceType(t); setPeriodEnd(''); }} />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {oldPrefill && !quotationId && (
            <p className="text-xs text-amber-700">Choose a Won quotation to create the invoice.</p>
          )}
          {quotationId && (
            <div className="grid gap-3 text-xs sm:grid-cols-4">
              <div><span className="block text-gray-600">Hire agreement</span>
                <span className="font-medium">{preview?.agreementNo ?? quotationAgreement?.agreementNo ?? '—'}</span></div>
              <div><span className="block text-gray-600">Hire dates</span>
                <span className="font-medium">
                  {preview?.hireStartDate ?? quotationAgreement?.hireStartDate ?? '—'} – {preview?.hireEndDate ?? quotationAgreement?.hireEndDate ?? '—'}
                </span></div>
              <div><span className="block text-gray-600">Period start</span>
                <span className="font-medium">{preview?.periodStart ?? '—'}</span></div>
              <div><span className="block text-gray-600">Period end</span>
                {invoiceType === 'Continuous Hire' ? (
                  <input type="date" className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                    aria-label="Period end" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                ) : (
                  <span className="font-medium">{preview?.hireEndDate ?? '—'}</span>
                )}
              </div>
            </div>
          )}
          {preview && !preview.ok && <p className="text-xs text-rose-600" role="alert">{preview.message}</p>}
          {saveError && <p className="text-xs text-rose-600" role="alert">{saveError}</p>}
        </div>
      )}

      <div id="invoice-print" className="mx-auto max-w-4xl bg-white text-gray-900 shadow-lg print:shadow-none print:max-w-none"
        style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px' }}>

        {/* HEADER */}
        <div className="flex items-stretch justify-between border border-blue-900">
          <div className="w-1/2 bg-blue-50 p-5">
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-blue-900">
              <FileText className="h-4 w-4" /> {issuer}
            </div>
            <div className="space-y-1 text-xs text-gray-500">
              <input className={inp} value={f.issuerName ?? ''} placeholder="Company name" onChange={(e) => set('issuerName', e.target.value)} />
              <input className={inp} value={f.issuerAddress ?? ''} placeholder="Address" onChange={(e) => set('issuerAddress', e.target.value)} />
              <div className="flex gap-2">
                <input className={inp} value={f.issuerPhone ?? ''} placeholder="Phone" onChange={(e) => set('issuerPhone', e.target.value)} />
                <input className={inp} value={f.issuerEmail ?? ''} placeholder="Email" onChange={(e) => set('issuerEmail', e.target.value)} />
              </div>
              <div className="flex gap-2">
                <input className={inp} value={f.issuerTradeLicense ?? ''} placeholder="Trade License" onChange={(e) => set('issuerTradeLicense', e.target.value)} />
                <input className={inp} value={f.issuerTrn ?? ''} placeholder="TRN" onChange={(e) => set('issuerTrn', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="w-1/2 p-5 text-right">
            <h1 className="text-3xl font-extrabold uppercase text-blue-900">Tax Invoice</h1>
            <div className="mt-3 space-y-1 text-xs">
              <p><b>Invoice No.:</b> <input className={`${inp} inline-block w-36`} value={f.invoiceNo ?? ''} readOnly={isLinked}
                onChange={(e) => set('invoiceNo', e.target.value)} /></p>
              <p><b>Invoice Date:</b> <input type="date" className={`${inp} inline-block w-36`} value={f.invoiceDate ?? ''} onChange={(e) => set('invoiceDate', e.target.value)} /></p>
              <p><b>Due Date:</b> <input type="date" className={`${inp} inline-block w-36`} value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value)} /></p>
              <p><b>Currency:</b> <input className={`${inp} inline-block w-36`} value={f.currency ?? 'AED'} onChange={(e) => set('currency', e.target.value)} /></p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* INVOICE DETAILS (first) */}
          <section>
            <h2 className={h2}>Invoice Details</h2>
            <table className="w-full border border-gray-200 text-xs">
              <tbody>
                <tr>
                  <td className={lab}>Hire Agreement No.</td>
                  <td className={cell}>
                    {/* The hire agreement dropdown is on every invoice. It is locked only on an invoice that is
                        already linked to its quotation, because the link is the invoice's identity. */}
                    <select className={inp} aria-label="Hire agreement"
                      value={(newMode ? (quotationAgreement?.agreementNo ?? f.hireAgreementNo) : f.hireAgreementNo) ?? ''}
                      disabled={linkedExisting}
                      title={linkedExisting ? 'Linked to its quotation; create a new invoice to bill another agreement' : undefined}
                      onChange={(e) => (newMode ? pickAgreementForNew(e.target.value) : pickAgreement(e.target.value))}>
                      <option value="">— Select Hire Agreement —</option>
                      {agreementList.map((a) => (
                        <option key={a.id} value={a.agreementNo}>
                          {a.agreementNo} — {a.customerName}{a.quotationId && wonIds.has(a.quotationId) ? ' (Won quotation)' : ''}
                        </option>
                      ))}
                      {f.hireAgreementNo && !agreementList.some((a) => a.agreementNo === f.hireAgreementNo) && (
                        <option value={f.hireAgreementNo}>{f.hireAgreementNo}</option>
                      )}
                    </select>
                    {newMode && agreementNote && <span className="mt-1 block text-amber-700">{agreementNote}</span>}
                  </td>
                  <td className={lab}>Hire Period</td>
                  <td className={cell}>{text('hirePeriod')}</td>
                </tr>
                <tr>
                  <td className={lab}>Quotation</td>
                  <td className={cell}>
                    {newMode ? (
                      <select className={inp} aria-label="Quotation" value={quotationId}
                        onChange={(e) => { setQuotationId(e.target.value); setPeriodEnd(''); setAgreementNote(''); setOldPrefill(false); }}>
                        <option value="">— Select Won quotation —</option>
                        {wonQuotations.map((q) => (
                          <option key={q.id} value={q.id}>{q.number} — {q.customerName}</option>
                        ))}
                      </select>
                    ) : (f.quotationNumber || <span className="text-gray-400">Not linked to a quotation</span>)}
                  </td>
                  <td className={lab}>Invoice Type</td>
                  <td className={cell}>
                    <select className={inp} aria-label="Invoice type"
                      value={newMode ? invoiceType : (f.invoiceType ?? 'Continuous Hire')}
                      onChange={(e) => {
                        const t = e.target.value as InvoiceType;
                        if (newMode) { setInvoiceType(t); setPeriodEnd(''); } else set('invoiceType', t);
                      }}>
                      <option value="Continuous Hire">Continuous Hire (monthly)</option>
                      <option value="Off-Hire">Off-Hire (final, after hire end)</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td className={lab}>Billing Period</td>
                  <td className={cell} colSpan={3}>
                    {isLinked ? (
                      <>
                        <span className="tabular-nums">{(newMode ? preview?.periodStart : f.periodStart) || '—'}</span>
                        {' – '}
                        {(newMode ? invoiceType : f.invoiceType) === 'Off-Hire' ? (
                          <span className="tabular-nums">{(newMode ? preview?.hireEndDate ?? quotationAgreement?.hireEndDate : f.periodEnd) || '—'}
                            <span className="text-gray-400"> (hire end date)</span></span>
                        ) : (
                          <input type="date" aria-label="Billing period end" className={`${inp} inline-block w-36`}
                            value={(newMode ? periodEnd : f.periodEnd) ?? ''}
                            onChange={(e) => (newMode ? setPeriodEnd(e.target.value) : set('periodEnd', e.target.value))} />
                        )}
                        {newMode && preview && !preview.ok && <span className="ml-2 text-rose-600">{preview.message}</span>}
                        {revision && !revision.ok && <span className="ml-2 text-rose-600" role="alert">{revision.message}</span>}
                      </>
                    ) : (
                      <>
                        <input type="date" aria-label="Billing period start" className={`${inp} inline-block w-36`}
                          value={f.periodStart ?? ''} onChange={(e) => setLegacyPeriod(e.target.value, f.periodEnd)} />
                        {' – '}
                        <input type="date" aria-label="Billing period end" className={`${inp} inline-block w-36`}
                          value={f.periodEnd ?? ''} onChange={(e) => setLegacyPeriod(f.periodStart, e.target.value)} />
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className={lab}>Delivery Location</td>
                  <td className={cell}>{text('deliveryLocation')}</td>
                  <td className={lab}>Payment Terms</td>
                  <td className={cell}>{text('paymentTerms')}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* BILL TO (second) */}
          <section>
            <h2 className={h2}>Bill To</h2>
            <table className="w-full border border-gray-200 text-xs">
              <tbody>
                <tr>
                  <td className={lab}>Customer Name</td><td className={cell}>{text('customerName')}</td>
                  <td className={lab}>Customer ID</td><td className={cell}>{text('customerId')}</td>
                </tr>
                <tr>
                  <td className={lab}>Customer TRN</td><td className={cell}>{text('customerTrn')}</td>
                  <td className={lab}>Attn</td><td className={cell}>{text('attn')}</td>
                </tr>
                <tr>
                  <td className={lab}>Contact</td><td className={cell}>{text('contactNumber')}</td>
                  <td className={lab}>Email</td><td className={cell}>{text('customerEmail')}</td>
                </tr>
                <tr>
                  <td className={lab}>Billing Address</td>
                  <td className={cell} colSpan={3}>{text('billingAddress')}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* ITEMS */}
          <section>
            <h2 className={h2}>Items / Services</h2>
            <table className="w-full border border-gray-200 text-xs">
              <thead>
                <tr className="bg-blue-50 text-blue-900">
                  <th className={`${cell} w-8 text-left`}>#</th>
                  <th className={`${cell} text-left`}>Description</th>
                  <th className={`${cell} w-16 text-left`}>Qty</th>
                  <th className={`${cell} w-28 text-left`}>Rate (AED)</th>
                  <th className={`${cell} w-28 text-left`}>Amount (AED)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={cell}>1</td>
                  <td className={cell}>
                    <textarea rows={2} className={`${inp} resize-none`} value={f.equipmentDescription ?? ''}
                      onChange={(e) => set('equipmentDescription', e.target.value)} />
                  </td>
                  <td className={cell}>{num('equipmentQty')}</td>
                  <td className={cell}>{num('equipmentRate')}</td>
                  <td className={cell}>{money(f.equipmentAmount)}</td>
                </tr>
                <tr>
                  <td className={cell}>2</td>
                  <td className={cell}>Transportation Charges</td>
                  <td className={cell}>{num('transportationQty')}</td>
                  <td className={cell}>{num('transportationRate')}</td>
                  <td className={cell}>{money(f.transportationAmount)}</td>
                </tr>
              </tbody>
            </table>
            <table className="ml-auto mt-3 w-72 border border-gray-200 text-xs">
              <tbody>
                <tr><td className={cell}>Subtotal</td><td className={`${cell} text-right`}>AED {money(f.subtotal)}</td></tr>
                <tr><td className={cell}>VAT @ 5%</td><td className={`${cell} text-right`}>AED {money(f.vat)}</td></tr>
                <tr className="bg-blue-50 font-bold text-blue-900">
                  <td className={cell}>TOTAL INCL. VAT</td><td className={`${cell} text-right`}>AED {money(f.totalAmount)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* PAYMENT INFORMATION */}
          <section>
            <h2 className={h2}>Payment Information</h2>
            <table className="w-full border border-gray-200 text-xs">
              <tbody>
                <tr>
                  <td className={lab}>Payment Method</td><td className={cell}>{text('paymentMethod')}</td>
                  <td className={lab}>Security Deposit</td>
                  <td className={cell}>{num('securityDeposit')}<span className="text-gray-400"> (not included above)</span></td>
                </tr>
                <tr>
                  <td className={lab}>Amount Due</td><td className={cell}>AED {money(f.amountDue)}</td>
                  <td className={lab}>Due Date</td>
                  <td className={cell}><input type="date" className={inp} value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value)} /></td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* NOTES */}
          <section>
            <h2 className={h2}>Notes</h2>
            <textarea rows={2} className="w-full border border-gray-200 p-2 text-xs focus:outline-none print:border-none"
              value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </section>

          {/* SIGNATURES */}
          <table className="w-full border border-blue-900 text-xs">
            <thead>
              <tr className="bg-blue-50 text-blue-900">
                <th className={`${cell} w-1/2 text-left`}>FOR {issuer.toUpperCase()}</th>
                <th className={`${cell} w-1/2 text-left`}>CUSTOMER ACKNOWLEDGEMENT – {(f.customerName || 'CUSTOMER').toUpperCase()}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="space-y-3 p-3">
                  <p>Authorized Signature: ______________________</p>
                  <p>Name: _________________________________</p>
                  <p>Company Stamp:</p>
                </td>
                <td className="space-y-3 p-3">
                  <p>Received By: _____________________________</p>
                  <p>Signature: ______________________________</p>
                  <p>Date: __________________________________</p>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs font-bold">Thank you for your business.</p>
        </div>

        <div className="flex justify-between border-t border-gray-300 px-6 py-2 text-[10px] text-gray-400">
          <span>{issuer} | TAX INVOICE</span><span>Page 1</span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pb-4 print:hidden">
        <Button variant="outline" onClick={() => setView('list')}>Cancel</Button>
        <Button variant="outline" onClick={download}><Download className="mr-1.5 h-4 w-4" /> Download / Print</Button>
        <Button onClick={save} disabled={saveDisabled}>Save Invoice</Button>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print, #invoice-print * { visibility: visible !important; }
          #invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
          #invoice-print input, #invoice-print textarea, #invoice-print select { border: none !important; appearance: none; }
        }
      `}</style>
    </div>
  );
}
