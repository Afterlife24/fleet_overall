// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/toast-helper', () => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useAuthStore, JA_ORG_ID, type AuthUser } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { taxInvoiceService } from '@/services/services';
import {
  InvoiceRuleError, createFromQuotation, updateInvoice, removeInvoice, listInvoices,
  type RuleCode,
} from '@/services/quotationInvoicing';
import { seedQuotations } from '@/services/mock/quotations';
import { hireAgreements as seedAgreements } from '@/services/mock/hireagreement';
import type { Quotation } from '@/types/quotation';
import type { HireAgreement } from '@/types/hireagreement';

// Requirements 1.3, 1.4, 1.5, 1.6, 1.7, 2.2, 2.3, 5.4, 6.8, 9.5, 9.8, 11.2

const QID = 'qt-test-won';
const HIRE_START = '2030-01-01';
const HIRE_END = '2030-03-31';

function quotation(over: Partial<Quotation> = {}): Quotation {
  return { ...seedQuotations[0], id: QID, orgId: JA_ORG_ID, number: 'QT-2030-0001', phase: 'Won', ...over };
}

function agreement(id: string, over: Partial<HireAgreement> = {}): HireAgreement {
  return {
    ...seedAgreements[0],
    id,
    orgId: JA_ORG_ID,
    quotationId: QID,
    agreementNo: `HA-TEST-${id}`,
    status: 'Active',
    hireStartDate: HIRE_START,
    hireEndDate: HIRE_END,
    ...over,
  } as HireAgreement;
}

function testInvoices() {
  return useTaxInvoiceStore.getState().invoices.filter((i) => i.quotationId === QID);
}

async function flush<T>(p: Promise<T>): Promise<T> {
  const settled = p.then((v) => v, (e) => { throw e; });
  settled.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(500);
  return settled;
}

async function codeOf(p: Promise<unknown>): Promise<RuleCode | undefined> {
  try {
    await flush(p);
  } catch (e) {
    expect(e).toBeInstanceOf(InvoiceRuleError);
    return (e as InvoiceRuleError).code;
  }
  return undefined;
}

function codeOfSync(fn: () => unknown): RuleCode | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvoiceRuleError);
    return (e as InvoiceRuleError).code;
  }
  return undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useAuthStore.setState({
    user: { orgId: JA_ORG_ID, name: 'Tester', email: 't@example.com', role: 'Admin' } as unknown as AuthUser,
    isAuthenticated: true,
  });
  useOrgStore.getState().activateApp(JA_ORG_ID, 'crm');
  useCrmStore.setState({ quotations: [...seedQuotations, quotation()] });
  useHireAgreementStore.setState({ agreements: [agreement('ha-test-1')], seededOrgs: [] });
  useTaxInvoiceStore.setState({ invoices: [], seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('taxInvoiceService.create', () => {
  it('rejects a request without a quotation and stores nothing', async () => {
    const before = useTaxInvoiceStore.getState().invoices.length;
    const code = await codeOf(taxInvoiceService.create({ invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    expect(code).toBe('QUOTATION_REQUIRED');
    expect(useTaxInvoiceStore.getState().invoices.length).toBe(before);
    expect(testInvoices()).toHaveLength(0);
  });

  it('rejects a quotation that is not Won and stores nothing', async () => {
    useCrmStore.setState({ quotations: [...seedQuotations, quotation({ phase: 'Awaiting' })] });
    const code = await codeOf(
      taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }),
    );
    expect(code).toBe('NOT_WON');
    expect(testInvoices()).toHaveLength(0);
  });

  it('rejects when the CRM app is inactive', async () => {
    const res = useOrgStore.getState().deactivateApp(JA_ORG_ID, 'crm');
    expect(res.success).toBe(true);
    const code = await codeOf(
      taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }),
    );
    expect(code).toBe('CRM_INACTIVE');
    expect(testInvoices()).toHaveLength(0);
  });

  it('rejects when no hire agreement is linked', async () => {
    useHireAgreementStore.setState({ agreements: [] });
    const code = await codeOf(
      taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }),
    );
    expect(code).toBe('NO_AGREEMENT');
    expect(testInvoices()).toHaveLength(0);
  });

  it('rejects when two agreements are linked', async () => {
    useHireAgreementStore.setState({ agreements: [agreement('ha-test-1'), agreement('ha-test-2')] });
    const code = await codeOf(
      taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }),
    );
    expect(code).toBe('AMBIGUOUS_AGREEMENT');
    expect(testInvoices()).toHaveLength(0);
  });

  it('two creates in a row get /01 then /02 with contiguous periods', async () => {
    const a = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    const b = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-02-28' }));
    expect(a.invoiceNo).toBe('QT-2030-0001/01');
    expect(b.invoiceNo).toBe('QT-2030-0001/02');
    expect(a.periodStart).toBe('2030-01-01');
    expect(a.periodEnd).toBe('2030-01-31');
    expect(b.periodStart).toBe('2030-02-01');
    expect(b.periodEnd).toBe('2030-02-28');
    expect(a.quotationId).toBe(QID);
    expect(testInvoices()).toHaveLength(2);
  });

  it('Off-Hire after a Continuous invoice to the hire end gives NOTHING_TO_BILL', async () => {
    await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: HIRE_END }));
    const code = await codeOf(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Off-Hire' }));
    expect(code).toBe('NOTHING_TO_BILL');
    expect(testInvoices()).toHaveLength(1);
  });
});

describe('taxInvoiceService.update / delete', () => {
  it('accepts an update on a legacy invoice', async () => {
    const list = await flush(taxInvoiceService.list());
    const legacy = list.find((i) => !i.quotationId);
    expect(legacy).toBeDefined();
    const updated = await flush(taxInvoiceService.update(legacy!.id, { notes: 'edited', invoiceNo: 'LEGACY-EDIT' }));
    expect(updated.notes).toBe('edited');
    expect(updated.invoiceNo).toBe('LEGACY-EDIT');
  });

  it('rejects a change to the quotation link or number on a linked invoice', async () => {
    const inv = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    expect(await codeOf(taxInvoiceService.update(inv.id, { invoiceNo: 'OTHER/01' }))).toBe('IMMUTABLE_FIELD');
    expect(await codeOf(taxInvoiceService.update(inv.id, { quotationId: 'other' }))).toBe('IMMUTABLE_FIELD');
  });

  it('re-dates the latest invoice through the period rules', async () => {
    const inv = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    const moved = await flush(taxInvoiceService.update(inv.id, { periodEnd: '2030-02-05' }));
    expect(moved.periodEnd).toBe('2030-02-05');
    expect(moved.hirePeriod).toBe('2030-01-01 – 2030-02-05');
    expect(moved.invoiceNo).toBe(inv.invoiceNo);
    expect(await codeOf(taxInvoiceService.update(inv.id, { periodEnd: '2031-01-01' }))).toBe('END_AFTER_HIRE_END');
    // The hire ends on 2030-03-31, so an Off-Hire is not due yet.
    expect(await codeOf(taxInvoiceService.update(inv.id, { invoiceType: 'Off-Hire' }))).toBe('OFF_HIRE_NOT_DUE');
    const stored = useTaxInvoiceStore.getState().getById(inv.id)!;
    expect(stored.invoiceType).toBe('Continuous Hire');
    expect(stored.periodEnd).toBe('2030-02-05');
  });

  it('cannot re-date an invoice that is not the latest', async () => {
    const a = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-02-28' }));
    expect(await codeOf(taxInvoiceService.update(a.id, { periodEnd: '2030-01-20' }))).toBe('NOT_LATEST_INVOICE');
  });

  it('allows editing an unprotected field on a linked invoice and recomputes totals', async () => {
    const inv = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    const updated = updateInvoice(inv.id, { notes: 'ok', totalAmount: 1 });
    expect(updated.notes).toBe('ok');
    expect(updated.totalAmount).not.toBe(1);
  });

  it('rejects deleting or cancelling a non-latest invoice with NOT_LATEST_INVOICE', async () => {
    const a = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' }));
    const b = await flush(taxInvoiceService.create({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-02-28' }));
    expect(await codeOf(taxInvoiceService.delete(a.id))).toBe('NOT_LATEST_INVOICE');
    expect(codeOfSync(() => updateInvoice(a.id, { status: 'Cancelled' }))).toBe('NOT_LATEST_INVOICE');
    expect(codeOfSync(() => removeInvoice(a.id, 'cancel'))).toBe('NOT_LATEST_INVOICE');
    expect(testInvoices()).toHaveLength(2);

    await flush(taxInvoiceService.delete(b.id));
    expect(testInvoices().map((i) => i.id)).toEqual([a.id]);
  });

  it('does not reuse a sequence number after deleting the latest invoice', () => {
    const a = createFromQuotation({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' });
    removeInvoice(a.id, 'delete');
    const b = createFromQuotation({ quotationId: QID, invoiceType: 'Continuous Hire', periodEnd: '2030-01-31' });
    expect(b.invoiceNo).toBe('QT-2030-0001/02');
    expect(listInvoices().some((i) => i.id === b.id)).toBe(true);
  });
});
