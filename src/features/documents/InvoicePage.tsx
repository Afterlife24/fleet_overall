import { useState } from 'react';
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
import { Plus, Download, ArrowLeft, FileText, Trash2 } from 'lucide-react';
import { toastSuccess, toastError } from '@/lib/toast-helper';

const money = (n: number) =>
  (n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function addDays(iso: string, days: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function recalc(f: Partial<TaxInvoice>): Partial<TaxInvoice> {
  const equipmentAmount = (f.equipmentQty ?? 0) * (f.equipmentRate ?? 0);
  const transportationAmount = (f.transportationQty ?? 0) * (f.transportationRate ?? 0);
  const subtotal = equipmentAmount + transportationAmount;
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const totalAmount = Math.round((subtotal + vat) * 100) / 100;
  return { ...f, equipmentAmount, transportationAmount, subtotal, vat, totalAmount, amountDue: totalAmount };
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

  const set = <K extends keyof TaxInvoice>(key: K, val: TaxInvoice[K]) =>
    setForm((p) => recalc({ ...p, [key]: val }));

  const openNew = () => {
    setForm(emptyInvoice(org, ((invoices as TaxInvoice[] | undefined)?.length ?? 0) + 1));
    setEditId(null);
    setView('form');
  };
  const openEdit = (r: TaxInvoice) => { setForm({ ...r }); setEditId(r.id); setView('form'); };

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
    try {
      if (editId) {
        await updateM.mutateAsync({ id: editId, data: form });
        toastSuccess('Invoice saved');
      } else {
        await createM.mutateAsync(form);
        toastSuccess('Invoice created');
      }
      setView('list');
    } catch {
      toastError('Could not save invoice');
    }
  };

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
      { key: 'totalAmount', header: 'Total (AED)', sortable: true, sortAccessor: (r) => r.totalAmount,
        render: (r) => <span className="font-semibold tabular-nums">AED {money(r.totalAmount)}</span> },
      { key: 'status', header: 'Status', sortable: true,
        render: (r) => <StatusBadge status={r.status} size="sm" /> },
      { key: 'id', header: '', width: '90px',
        render: (r) => (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-600"
              onClick={(e) => { e.stopPropagation(); deleteM.mutate(r.id, { onSuccess: () => toastSuccess('Invoice deleted') }); }}>
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
        {isLoading ? <LoadingState /> : (
          <DataTable<TaxInvoice>
            columns={cols}
            data={(invoices ?? []) as TaxInvoice[]}
            searchable
            searchPlaceholder="Search invoices…"
            searchKeys={['invoiceNo', 'customerName', 'hireAgreementNo', 'status']}
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
  const issuer = f.issuerName || org?.name || 'Your Company';
  const text = (key: keyof TaxInvoice, placeholder?: string) => (
    <input className={inp} value={String(f[key] ?? '')} placeholder={placeholder}
      onChange={(e) => set(key, e.target.value as any)} />
  );
  const num = (key: keyof TaxInvoice, right = false) => (
    <input type="number" className={`${inp} ${right ? 'text-right' : ''}`} value={Number(f[key] ?? 0)}
      onChange={(e) => set(key, Number(e.target.value) as any)} />
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
          <Button size="sm" onClick={save} disabled={createM.isPending || updateM.isPending}>Save</Button>
        </div>
      </div>

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
              <p><b>Invoice No.:</b> <input className={`${inp} inline-block w-36`} value={f.invoiceNo ?? ''} onChange={(e) => set('invoiceNo', e.target.value)} /></p>
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
                    <select className={inp} value={f.hireAgreementNo ?? ''} onChange={(e) => pickAgreement(e.target.value)}>
                      <option value="">— Select Hire Agreement —</option>
                      {((agreements ?? []) as HireAgreement[]).map((a) => (
                        <option key={a.id} value={a.agreementNo}>{a.agreementNo} — {a.customerName}</option>
                      ))}
                    </select>
                  </td>
                  <td className={lab}>Hire Period</td>
                  <td className={cell}>{text('hirePeriod')}</td>
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
        <Button onClick={save} disabled={createM.isPending || updateM.isPending}>Save Invoice</Button>
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
