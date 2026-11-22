// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/toast-helper', () => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useAuthStore, JA_ORG_ID, type AuthUser } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { ensureHireLinkDemo, ensureInvoiceDemo } from '@/services/demoSeed';
import { previewInvoice } from '@/services/quotationInvoicing';
import { demoQuotationId, DEMO_AGREEMENT_QUOTATION } from '@/services/mock/demoHireLink';

// Requirements 12.1, 12.2, 12.3, 12.4

const OTHER_ORG = 'org-demo-two';

function setOrg(orgId: string) {
  useAuthStore.setState({
    user: { orgId, name: 'Tester', email: 't@example.com', role: 'Admin' } as unknown as AuthUser,
    isAuthenticated: true,
  });
  useOrgStore.getState().activateApp(orgId, 'crm');
}

function invoicesFor(orgId: string) {
  return useTaxInvoiceStore.getState().invoices.filter((i) => i.orgId === orgId && i.quotationId);
}

beforeEach(() => {
  localStorage.clear();
  useCrmStore.getState().resetToSeed();
  useHireAgreementStore.setState({ agreements: [], seededOrgs: [] });
  useTaxInvoiceStore.setState({ invoices: [], seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} });
});

describe('demo linked invoice', () => {
  it('exists for org-ja with counter 1 and next invoice gets /02', () => {
    setOrg(JA_ORG_ID);
    ensureInvoiceDemo(JA_ORG_ID);
    const qid = demoQuotationId(JA_ORG_ID, DEMO_AGREEMENT_QUOTATION[5]);
    const linked = invoicesFor(JA_ORG_ID);
    expect(linked).toHaveLength(1);
    expect(linked[0].quotationId).toBe(qid);
    expect(linked[0].invoiceNo).toMatch(/\/01$/);
    expect(linked[0].periodStart).toBe('2026-11-14');
    expect(linked[0].periodEnd).toBe('2026-11-30');
    expect(linked[0].status).toBe('Sent');
    expect(useTaxInvoiceStore.getState().sequenceByQuotation[qid]).toBe(1);

    const p = previewInvoice({ quotationId: qid, invoiceType: 'Continuous Hire', periodEnd: '2026-12-01' });
    expect(p.message).toBeUndefined();
    expect(p.ok).toBe(true);
    expect(p.sequence).toBe(2);
    expect(p.invoiceNo).toMatch(/\/02$/);
    expect(p.periodStart).toBe('2026-12-01');
  });

  it('exists for a second org after hire-link demo is loaded', () => {
    setOrg(OTHER_ORG);
    ensureHireLinkDemo(OTHER_ORG);
    const qid = demoQuotationId(OTHER_ORG, DEMO_AGREEMENT_QUOTATION[5]);
    const linked = invoicesFor(OTHER_ORG);
    expect(linked).toHaveLength(1);
    expect(linked[0].id).toBe(`inv-demo-${OTHER_ORG}-1`);
    expect(linked[0].quotationId).toBe(qid);
    expect(useTaxInvoiceStore.getState().sequenceByQuotation[qid]).toBe(1);
    expect(useTaxInvoiceStore.getState().demoLinkedOrgs).toContain(OTHER_ORG);

    const p = previewInvoice({ quotationId: qid, invoiceType: 'Continuous Hire', periodEnd: '2026-12-01' });
    expect(p.ok).toBe(true);
    expect(p.invoiceNo).toMatch(/\/02$/);
  });

  it('is inserted only once when called repeatedly', () => {
    setOrg(OTHER_ORG);
    ensureHireLinkDemo(OTHER_ORG);
    ensureInvoiceDemo(OTHER_ORG);
    ensureHireLinkDemo(OTHER_ORG);
    expect(invoicesFor(OTHER_ORG)).toHaveLength(1);
  });

  it('does not re-add a deleted sample', () => {
    setOrg(OTHER_ORG);
    ensureHireLinkDemo(OTHER_ORG);
    const sample = invoicesFor(OTHER_ORG)[0];
    useTaxInvoiceStore.getState().remove(sample.id);
    expect(invoicesFor(OTHER_ORG)).toHaveLength(0);

    ensureInvoiceDemo(OTHER_ORG);
    ensureHireLinkDemo(OTHER_ORG);
    previewInvoice({ quotationId: sample.quotationId, invoiceType: 'Continuous Hire', periodEnd: '2026-12-01' });
    expect(invoicesFor(OTHER_ORG)).toHaveLength(0);
  });

  it('skips when the quotation is missing from the CRM store', () => {
    setOrg(OTHER_ORG);
    ensureInvoiceDemo(OTHER_ORG);
    expect(invoicesFor(OTHER_ORG)).toHaveLength(0);
    expect(useTaxInvoiceStore.getState().demoLinkedOrgs).not.toContain(OTHER_ORG);
  });
});
