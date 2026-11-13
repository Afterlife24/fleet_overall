import { useState, useEffect, useRef } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/common/EmptyState';
import { useHireAgreements, useCreateHireAgreement, useUpdateHireAgreement, useDeleteHireAgreement, useCustomerANIs } from '@/hooks/useQueries';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import type { HireAgreement } from '@/types/hireagreement';
import type { CustomerANI } from '@/types/customerani';
import { cn } from '@/lib/utils';
import { Plus, Download, ArrowLeft, FileText, Trash2 } from 'lucide-react';
import { toastSuccess, toastError } from '@/lib/toast-helper';

function calcTotals(monthly: number, transport: number) {
  const subtotal = monthly + transport;
  const vat = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  return { subtotal, vat, total };
}

function formatMoney(n: number) {
  return n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyForm(org: { name?: string; tradeLicense?: string; companyTrn?: string; companyAddress?: string; companyPhone?: string; companyEmail?: string } | undefined, seq: number): Partial<HireAgreement> {
  const year = new Date().getFullYear();
  return {
    agreementNo: `HA-${year}-${String(seq).padStart(3, '0')}`,
    date: new Date().toISOString().slice(0, 10),
    status: 'Draft',
    lessorName: org?.name ?? '',
    lessorTradeLicense: org?.tradeLicense ?? '',
    lessorTrn: org?.companyTrn ?? '',
    lessorAddress: org?.companyAddress ?? '',
    lessorPhone: org?.companyPhone ?? '',
    lessorEmail: org?.companyEmail ?? '',
    customerId: '', customerName: '', customerTrn: '',
    attn: '', contactPerson: '', contactNumber: '',
    customerEmail: '', billingAddress: '',
    equipmentName: '', equipmentModel: '', serialNumber: '',
    quantity: 1, capacity: '', workingHeight: '',
    deliveryLocation: '', hireStartDate: '', hireEndDate: '', hireDuration: '30 days',
    monthlyRental: 0, transportationCharges: 0, subtotal: 0, vat: 0, totalAmount: 0,
    paymentTerms: '30 Days', securityDeposit: 0, paymentMethod: 'Bank Transfer',
  };
}

const TERMS = (lessor: string, customer: string) => [
  `The customer shall use the hired equipment only for its intended purpose and in accordance with applicable safety requirements.`,
  `The customer is responsible for the safe operation and security of the equipment during the hire period.`,
  `Damage resulting from misuse, negligence or unauthorized operation may be charged to the customer, subject to applicable law and the agreed contract.`,
  `The equipment must be returned in good working condition, excluding normal wear and tear.`,
  `Any extension of the hire period must be approved by ${lessor} in advance.`,
  `Additional rental charges may apply for equipment retained beyond the agreed hire period.`,
  `${customer || 'The customer'} shall settle invoices within the agreed payment period.`,
  `${lessor} may take lawful steps to recover its equipment in the event of non-payment or material breach.`,
  `Both parties agree to comply with applicable laws and regulations of the United Arab Emirates.`,
];

export function HireAgreementPage() {
  const { data: agreements, isLoading, isError, refetch } = useHireAgreements();
  const { data: customers } = useCustomerANIs();
  const createMutation = useCreateHireAgreement();
  const updateMutation = useUpdateHireAgreement();
  const deleteMutation = useDeleteHireAgreement();

  const user = useAuthStore((s) => s.user);
  const getOrg = useOrgStore((s) => s.getOrg);
  const org = user ? getOrg(user.orgId) : undefined;

  const [view, setView] = useState<'list' | 'form'>('list');
  const [editRecord, setEditRecord] = useState<Partial<HireAgreement> | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Form field state
  const [form, setForm] = useState<Partial<HireAgreement>>({});

  const openNew = () => {
    const seq = ((agreements as HireAgreement[] | undefined)?.length ?? 0) + 1;
    setForm(emptyForm(org, seq));
    setEditRecord(null);
    setView('form');
  };

  const openEdit = (rec: HireAgreement) => {
    setForm({ ...rec });
    setEditRecord(rec);
    setView('form');
  };

  const setField = <K extends keyof HireAgreement>(key: K, val: HireAgreement[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      // recalculate totals when rental or transport changes
      if (key === 'monthlyRental' || key === 'transportationCharges') {
        const { subtotal, vat, total } = calcTotals(
          key === 'monthlyRental' ? (val as number) : (prev.monthlyRental ?? 0),
          key === 'transportationCharges' ? (val as number) : (prev.transportationCharges ?? 0)
        );
        return { ...next, subtotal, vat, totalAmount: total };
      }
      return next;
    });
  };

  // Auto-fill when Customer Name is selected from dropdown
  const handleCustomerNameSelect = (name: string) => {
    const match = (customers as CustomerANI[] ?? []).find(
      (c) => c.customerName === name
    );
    if (match) {
      setForm((prev) => ({
        ...prev,
        customerName: match.customerName,
        customerId: match.customerId,
        customerTrn: match.trn,
        attn: match.attn ?? '',
        contactPerson: match.attn ?? '',
        contactNumber: match.contactNumber,
        customerEmail: match.email ?? '',
        billingAddress: match.billingAddress ?? match.address,
      }));
    } else {
      setField('customerName', name);
    }
  };

  // Auto-fill customer details when Customer ID changes
  const handleCustomerIdChange = (id: string) => {
    setField('customerId', id);
    const match = (customers as CustomerANI[] ?? []).find(
      (c) => c.customerId.toLowerCase() === id.toLowerCase()
    );
    if (match) {
      setForm((prev) => ({
        ...prev,
        customerId: id,
        customerName: match.customerName,
        customerTrn: match.trn,
        attn: match.attn ?? '',
        contactPerson: match.attn ?? '',
        contactNumber: match.contactNumber,
        customerEmail: match.email ?? '',
        billingAddress: match.billingAddress ?? match.address,
      }));
    }
  };

  const handleSave = async () => {
    try {
      if (editRecord?.id) {
        await updateMutation.mutateAsync({ id: editRecord.id, data: { ...form, status: form.status ?? 'Active' } });
        toastSuccess('Agreement saved');
      } else {
        await createMutation.mutateAsync({ ...form, status: 'Active' });
        toastSuccess('Agreement created');
      }
      setView('list');
    } catch {
      toastError('Could not save agreement');
    }
  };

  const handleDownload = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 100);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => toastSuccess('Agreement deleted'),
    });
  };

  const listColumns: Column<HireAgreement>[] = [
    { key: 'agreementNo', header: 'Agreement No.', sortable: true,
      render: (r) => <span className="font-mono text-xs font-semibold text-foreground">{r.agreementNo}</span> },
    { key: 'date', header: 'Date', sortable: true,
      render: (r) => <span className="text-sm">{r.date}</span> },
    { key: 'customerName', header: 'Customer', sortable: true,
      render: (r) => <span className="font-medium">{r.customerName}</span> },
    { key: 'equipmentModel', header: 'Equipment', sortable: true,
      render: (r) => <span className="text-sm text-muted-foreground">{r.equipmentName} — {r.equipmentModel}</span> },
    { key: 'totalAmount', header: 'Total (AED)', sortable: true, sortAccessor: (r) => r.totalAmount,
      render: (r) => <span className="font-semibold tabular-nums">AED {formatMoney(r.totalAmount)}</span> },
    { key: 'status', header: 'Status', sortable: true,
      render: (r) => <StatusBadge status={r.status} size="sm" /> },
    { key: 'id', header: '', width: '90px',
      render: (r) => (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700" onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )},
  ];

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (view === 'list') {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Quotation / Hire Agreement"
          description="Create, manage and download equipment hire agreements"
          actions={
            <Button size="sm" onClick={openNew}>
              <Plus className="mr-1.5 h-4 w-4" /> New Agreement
            </Button>
          }
        />
        {isLoading ? <LoadingState /> : (
          <DataTable<HireAgreement>
            columns={listColumns}
            data={(agreements ?? []) as HireAgreement[]}
            searchable
            searchPlaceholder="Search agreements…"
            searchKeys={['agreementNo', 'customerName', 'equipmentModel', 'status']}
            initialSort={{ key: 'agreementNo', direction: 'desc' }}
            onRowClick={(r) => openEdit(r)}
            rowKey={(r) => r.id}
            pageSize={10}
            emptyMessage="No hire agreements yet. Click 'New Agreement' to create one."
          />
        )}
      </div>
    );
  }

  // ── FORM VIEW ──────────────────────────────────────────────────────────────
  const f = form as HireAgreement;

  return (
    <div className="space-y-4 print:space-y-0">
      {/* Toolbar — hidden when printing */}
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="outline" size="sm" onClick={() => setView('list')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to List
        </Button>
        <span className="text-sm text-muted-foreground">
          {editRecord ? `Editing ${f.agreementNo}` : 'New Agreement'}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="mr-1.5 h-4 w-4" /> Download / Print
          </Button>
          <Button size="sm" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
            {createMutation.isPending || updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* ── THE PRINTABLE / FORM DOCUMENT ────────────────────────────────── */}
      <div
        ref={printRef}
        id="hire-agreement-print"
        className="mx-auto max-w-4xl bg-white text-gray-900 shadow-lg print:shadow-none print:max-w-none"
        style={{ fontFamily: 'Arial, sans-serif', fontSize: '13px' }}
      >
        {/* ── HEADER ── */}
        <div className="flex items-start justify-between border-b-4 border-blue-800 p-6">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-1.5">
              <FileText className="h-5 w-5 text-blue-700" />
              <span className="text-sm font-bold text-blue-700">{f.lessorName || org?.name || 'Your Company'}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{f.lessorAddress || org?.companyAddress || ''}</p>
            <p className="text-xs text-gray-500">
              Tel: {f.lessorPhone || org?.companyPhone || ''}{f.lessorEmail || org?.companyEmail ? ` | Email: ${f.lessorEmail || org?.companyEmail}` : ''}
            </p>
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-extrabold uppercase leading-tight text-blue-800">
              Equipment Hire<br />Agreement
            </h1>
            <div className="mt-2 text-xs">
              <p><span className="font-semibold">Agreement No.:</span>{' '}
                <input
                  className="print:border-none border-b border-gray-300 bg-transparent text-xs w-32 focus:outline-none print:w-auto"
                  value={f.agreementNo ?? ''}
                  onChange={(e) => setField('agreementNo', e.target.value)}
                />
              </p>
              <p className="mt-1"><span className="font-semibold">Date:</span>{' '}
                <input
                  type="date"
                  className="print:border-none border-b border-gray-300 bg-transparent text-xs focus:outline-none"
                  value={f.date ?? ''}
                  onChange={(e) => setField('date', e.target.value)}
                />
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">

          {/* ── SECTION 1: COMPANY / LESSOR ── */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-blue-800 border-b border-blue-200 pb-1">
              1. Company Details – Lessor
            </h2>
            <table className="w-full text-xs border border-gray-200">
              <thead>
                <tr className="bg-blue-50">
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800 w-48">Particulars</th>
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800">Company Information</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Company Name', 'lessorName', f.lessorName || org?.name || ''],
                  ['Trade License No.', 'lessorTradeLicense', f.lessorTradeLicense || org?.tradeLicense || ''],
                  ['VAT Registration No. (TRN)', 'lessorTrn', f.lessorTrn || org?.companyTrn || ''],
                  ['Company Address', 'lessorAddress', f.lessorAddress || org?.companyAddress || ''],
                  ['Contact', 'lessorPhone', f.lessorPhone || org?.companyPhone || ''],
                  ['Email', 'lessorEmail', f.lessorEmail || org?.companyEmail || ''],
                ] as [string, keyof HireAgreement, string][]).map(([label, key, placeholder]) => (
                  <tr key={key} className="even:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-1.5 font-medium">{label}</td>
                    <td className="border border-gray-200 px-3 py-1.5">
                      <input
                        className="w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                        value={String(f[key] ?? '')}
                        onChange={(e) => setField(key, e.target.value as any)}
                        placeholder={placeholder || label}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── SECTION 2: CUSTOMER / HIRER ── */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-blue-800 border-b border-blue-200 pb-1">
              2. Customer Details – Hirer
            </h2>
            <table className="w-full text-xs border border-gray-200">
              <thead>
                <tr className="bg-blue-50">
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800 w-48">Particulars</th>
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800">Customer Information</th>
                </tr>
              </thead>
              <tbody>
                {/* Customer Name FIRST — dropdown auto-fills all other fields */}
                <tr className="even:bg-gray-50">
                  <td className="border border-gray-200 px-3 py-1.5 font-medium">Customer Name</td>
                  <td className="border border-gray-200 px-3 py-1.5">
                    <select
                      className="w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                      value={f.customerName ?? ''}
                      onChange={(e) => handleCustomerNameSelect(e.target.value)}
                    >
                      <option value="">— Select Customer —</option>
                      {(customers as CustomerANI[] ?? []).map((c) => (
                        <option key={c.id} value={c.customerName}>{c.customerName}</option>
                      ))}
                    </select>
                  </td>
                </tr>
                {/* Customer ID — auto-filled, still editable */}
                <tr>
                  <td className="border border-gray-200 px-3 py-1.5 font-medium">Customer ID</td>
                  <td className="border border-gray-200 px-3 py-1.5">
                    <input
                      className="w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                      value={f.customerId ?? ''}
                      onChange={(e) => handleCustomerIdChange(e.target.value)}
                      placeholder="Auto-filled from Customer Name…"
                      list="customer-id-list"
                    />
                    <datalist id="customer-id-list">
                      {(customers as CustomerANI[] ?? []).map((c) => (
                        <option key={c.id} value={c.customerId}>{c.customerName}</option>
                      ))}
                    </datalist>
                  </td>
                </tr>
                {([
                  ['TRN No.', 'customerTrn'],
                  ['Attention (Attn)', 'attn'],
                  ['Contact Person', 'contactPerson'],
                  ['Contact Number', 'contactNumber'],
                  ['Email', 'customerEmail'],
                  ['Billing Address', 'billingAddress'],
                ] as [string, keyof HireAgreement][]).map(([label, key]) => (
                  <tr key={key} className="even:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-1.5 font-medium">{label}</td>
                    <td className="border border-gray-200 px-3 py-1.5">
                      <input
                        className="w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                        value={String(f[key] ?? '')}
                        onChange={(e) => setField(key, e.target.value as any)}
                        placeholder={label}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── SECTION 3: EQUIPMENT ── */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-blue-800 border-b border-blue-200 pb-1">
              3. Equipment / Machinery Details
            </h2>
            <table className="w-full text-xs border border-gray-200">
              <thead>
                <tr className="bg-blue-50">
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800 w-48">Description</th>
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800">Details</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Equipment Name', 'equipmentName'],
                  ['Equipment Model', 'equipmentModel'],
                  ['Serial Number', 'serialNumber'],
                  ['Quantity', 'quantity'],
                  ['Equipment Capacity', 'capacity'],
                  ['Working Height', 'workingHeight'],
                  ['Delivery Location', 'deliveryLocation'],
                  ['Hire Start Date', 'hireStartDate'],
                  ['Hire End Date', 'hireEndDate'],
                  ['Hire Duration', 'hireDuration'],
                ] as [string, keyof HireAgreement][]).map(([label, key]) => (
                  <tr key={key} className="even:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-1.5 font-medium">{label}</td>
                    <td className="border border-gray-200 px-3 py-1.5">
                      <input
                        type={key === 'hireStartDate' || key === 'hireEndDate' ? 'date' : key === 'quantity' ? 'number' : 'text'}
                        className="w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                        value={String(f[key] ?? '')}
                        onChange={(e) => setField(key, (key === 'quantity' ? Number(e.target.value) : e.target.value) as any)}
                        placeholder={label}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── SECTION 4: RENTAL CHARGES ── */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-blue-800 border-b border-blue-200 pb-1">
              4. Rental Charges
            </h2>
            <table className="w-full text-xs border border-gray-200">
              <thead>
                <tr className="bg-blue-50">
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold text-blue-800">Description</th>
                  <th className="border border-gray-200 px-3 py-1.5 text-right font-semibold text-blue-800 w-40">Amount (AED)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="even:bg-gray-50">
                  <td className="border border-gray-200 px-3 py-1.5">Monthly Rental Charges</td>
                  <td className="border border-gray-200 px-3 py-1.5 text-right">
                    <input
                      type="number"
                      className="w-full text-right border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                      value={f.monthlyRental ?? 0}
                      onChange={(e) => setField('monthlyRental', Number(e.target.value))}
                    />
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-3 py-1.5">Transportation Charges</td>
                  <td className="border border-gray-200 px-3 py-1.5 text-right">
                    <input
                      type="number"
                      className="w-full text-right border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                      value={f.transportationCharges ?? 0}
                      onChange={(e) => setField('transportationCharges', Number(e.target.value))}
                    />
                  </td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="border border-gray-200 px-3 py-1.5">Subtotal</td>
                  <td className="border border-gray-200 px-3 py-1.5 text-right font-medium">{formatMoney(f.subtotal ?? 0)}</td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-3 py-1.5">VAT (5%)</td>
                  <td className="border border-gray-200 px-3 py-1.5 text-right">{formatMoney(f.vat ?? 0)}</td>
                </tr>
                <tr className="bg-blue-50">
                  <td className="border border-gray-200 px-3 py-1.5 font-bold text-blue-800">TOTAL AMOUNT</td>
                  <td className="border border-gray-200 px-3 py-1.5 text-right font-bold text-blue-800">{formatMoney(f.totalAmount ?? 0)}</td>
                </tr>
              </tbody>
            </table>
            <table className="mt-1 w-full text-xs border border-gray-200">
              <tbody>
                {([
                  ['Payment Terms', 'paymentTerms'],
                  ['Security Deposit', 'securityDeposit'],
                  ['Payment Method', 'paymentMethod'],
                ] as [string, keyof HireAgreement][]).map(([label, key]) => (
                  <tr key={key} className="even:bg-gray-50">
                    <td className="border border-gray-200 px-3 py-1.5 font-semibold w-48">{label}</td>
                    <td className="border border-gray-200 px-3 py-1.5">
                      <input
                        type={key === 'securityDeposit' ? 'number' : 'text'}
                        className="w-full border-b border-gray-300 bg-transparent focus:outline-none print:border-none"
                        value={String(f[key] ?? '')}
                        onChange={(e) => setField(key, (key === 'securityDeposit' ? Number(e.target.value) : e.target.value) as any)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── SECTION 5: TERMS ── */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-blue-800 border-b border-blue-200 pb-1">
              5. Terms and Conditions
            </h2>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-gray-700">
              {TERMS(f.lessorName || org?.name || 'The Company', f.customerName || 'The Customer').map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </section>

          {/* ── SECTION 6: DECLARATION ── */}
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase text-blue-800 border-b border-blue-200 pb-1">
              6. Declaration and Acceptance
            </h2>
            <p className="mb-4 text-xs text-gray-700">
              {f.lessorName || org?.name || 'The Company'} and {f.customerName || 'the Customer'} confirm that
              the equipment hire details stated in this agreement are correct and agree to the terms and conditions
              set out above. Each party acknowledges receipt of a copy.
            </p>
            <table className="w-full text-xs border border-gray-200">
              <tbody>
                <tr>
                  <td className="border border-gray-200 p-4 w-1/2 align-top">
                    <p className="font-bold text-blue-800 mb-4">FOR {(f.lessorName || org?.name || 'THE COMPANY').toUpperCase()}</p>
                    <p className="mb-3">Authorized Person: <span className="inline-block w-40 border-b border-gray-400">&nbsp;</span></p>
                    <p className="mb-3">Designation: <span className="inline-block w-44 border-b border-gray-400">&nbsp;</span></p>
                    <p className="mb-3">Signature: <span className="inline-block w-48 border-b border-gray-400">&nbsp;</span></p>
                    <p className="mb-6">Company Stamp:</p>
                    <p>Date: <span className="inline-block w-48 border-b border-gray-400">&nbsp;</span></p>
                  </td>
                  <td className="border border-gray-200 p-4 w-1/2 align-top">
                    <p className="font-bold text-blue-800 mb-4">FOR {(f.customerName || 'THE CUSTOMER').toUpperCase()}</p>
                    <p className="mb-3">Authorized Person: <span className="inline-block w-40 border-b border-gray-400">&nbsp;</span></p>
                    <p className="mb-3">Designation: <span className="inline-block w-44 border-b border-gray-400">&nbsp;</span></p>
                    <p className="mb-3">Signature: <span className="inline-block w-48 border-b border-gray-400">&nbsp;</span></p>
                    <p className="mb-6">Company Stamp:</p>
                    <p>Date: <span className="inline-block w-48 border-b border-gray-400">&nbsp;</span></p>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4 text-center text-xs font-semibold text-gray-700">
              Thank you for doing business with {f.lessorName || org?.name || 'us'}.
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="border-t border-gray-300 px-6 py-2 text-[10px] text-gray-400 flex justify-between">
          <span>{f.lessorName || org?.name || ''} | EQUIPMENT HIRE AGREEMENT</span>
          <span>Page 1</span>
        </div>
      </div>

      {/* Bottom action bar — hidden when printing */}
      <div className="flex justify-end gap-3 pb-4 print:hidden">
        <Button variant="outline" onClick={() => setView('list')}>Cancel</Button>
        <Button variant="outline" onClick={handleDownload}>
          <Download className="mr-1.5 h-4 w-4" /> Download / Print
        </Button>
        <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
          {createMutation.isPending || updateMutation.isPending ? 'Saving…' : 'Save Agreement'}
        </Button>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #hire-agreement-print { display: block !important; }
          #hire-agreement-print input { border: none !important; }
        }
      `}</style>
    </div>
  );
}
