// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));
vi.mock('@/services/demoSeed', () => ({ ensureHireLinkDemo: vi.fn() }));

import { useAuthStore, type AuthUser } from '@/store/authStore';
import { useCrmStore } from '@/store/crmStore';
import type { Quotation, QuotationPhase } from '@/types/quotation';
import { CrmPage } from '../CrmPage';

const ORG = 'org-pipe-test';

function setOrg(orgId: string) {
  useAuthStore.setState({
    user: { orgId, name: 'Tester', email: 't@example.com', role: 'Managing Director' } as unknown as AuthUser,
    isAuthenticated: true,
  });
}

const q = (id: string, phase: QuotationPhase, over: Partial<Quotation> = {}): Quotation => ({
  id, orgId: ORG, number: `QT-2026-${id}`, opportunity: `Opp ${id}`, hireAgreementNo: 'HA-2026-00001',
  customerId: 'CUST-000125', customerName: 'ABC Company LLC', amount: 1000, currency: 'AED', phase,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  history: [{ id: `h-${id}`, timestamp: '2026-01-01T00:00:00Z', user: 'u', fromPhase: null, toPhase: 'Awaiting' }],
  ...over,
});

const phaseOf = (id: string) => useCrmStore.getState().quotations.find((x) => x.id === id)!.phase;
const col = (p: string) => within(screen.getByTestId(`column-${p}`));
const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

function renderPage() {
  return render(<MemoryRouter><CrmPage /></MemoryRouter>);
}

beforeEach(() => {
  toasts.error.mockClear();
  toasts.success.mockClear();
  setOrg(ORG);
  useCrmStore.setState({ quotations: [q('A1', 'Awaiting'), q('T1', 'Tender'), q('L1', 'Lost', { lostReason: 'x' }), q('W1', 'Won')] });
});
afterEach(cleanup);

describe('CRM pipeline board', () => {
  it('shows four columns in order with counts and amounts and no per-card buttons', () => {
    renderPage();
    const heads = ['Awaiting', 'Tender', 'Lost', 'Won'];
    const cols = screen.getAllByTestId(/^column-/).map((c) => c.getAttribute('data-testid'));
    expect(cols).toEqual(heads.map((h) => `column-${h}`));
    for (const h of heads) {
      expect(screen.getByTestId(`count-${h}`).textContent).toBe('1');
      expect(screen.getByTestId(`amount-${h}`).textContent).toBe('AED 1,000');
    }
    expect(screen.queryByRole('button', { name: /^(Tender|Won|Lost)$/ })).toBeNull();
  });

  it('shows empty-column text and keeps the column visible', () => {
    useCrmStore.setState({ quotations: [q('A1', 'Awaiting')] });
    renderPage();
    expect(col('Won').getByText('No quotations')).toBeTruthy();
    expect(screen.getByTestId('amount-Won').textContent).toBe('AED 0');
  });
});

describe('CRM Status panel', () => {
  it('opens on card click, replaces on another click and closes', () => {
    renderPage();
    fireEvent.click(col('Awaiting').getByText('Opp A1'));
    expect(screen.getAllByTestId('status-editor')).toHaveLength(1);
    expect(screen.getByText('QT-2026-A1 · ABC Company LLC')).toBeTruthy();
    fireEvent.click(col('Tender').getByText('Opp T1'));
    expect(screen.getAllByTestId('status-editor')).toHaveLength(1);
    expect(screen.getByText('QT-2026-T1 · ABC Company LLC')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('status-editor')).toBeNull();
    expect(screen.getAllByTestId(/^column-/)).toHaveLength(4);
  });

  it('keeps Save disabled until a different allowed status is chosen and disables rule-breaking options', () => {
    renderPage();
    fireEvent.click(col('Awaiting').getByText('Opp A1'));
    expect(statusSelect().value).toBe('Awaiting');
    expect(save().disabled).toBe(true);
    const won = within(statusSelect()).getByRole('option', { name: /Won/ }) as HTMLOptionElement;
    expect(won.disabled).toBe(true);
    expect(won.textContent).toContain('Cannot move quotation from Awaiting to Won');
    fireEvent.change(statusSelect(), { target: { value: 'Tender' } });
    expect(save().disabled).toBe(false);
  });

  it('saves a move, keeps the panel open on the new phase and moves the card', () => {
    renderPage();
    fireEvent.click(col('Awaiting').getByText('Opp A1'));
    fireEvent.change(statusSelect(), { target: { value: 'Tender' } });
    fireEvent.click(save());
    expect(phaseOf('A1')).toBe('Tender');
    expect(col('Tender').getByText('Opp A1')).toBeTruthy();
    expect(statusSelect().value).toBe('Tender');
    expect(save().disabled).toBe(true);
    expect(screen.getByText('Awaiting → Tender')).toBeTruthy();
    expect(toasts.success).toHaveBeenCalled();
  });

  it('requires a reason for Lost and shows a field message while blank', () => {
    renderPage();
    fireEvent.click(col('Awaiting').getByText('Opp A1'));
    fireEvent.change(statusSelect(), { target: { value: 'Lost' } });
    expect(screen.getByRole('alert').textContent).toMatch(/reason is required/i);
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    expect(save().disabled).toBe(true);
    expect(phaseOf('A1')).toBe('Awaiting');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Price too high' } });
    fireEvent.click(save());
    expect(phaseOf('A1')).toBe('Lost');
    expect(useCrmStore.getState().quotations.find((x) => x.id === 'A1')!.lostReason).toBe('Price too high');
  });

  it('disables every other option for a Won quotation', () => {
    renderPage();
    fireEvent.click(col('Won').getByText('Opp W1'));
    const others = within(statusSelect()).getAllByRole('option').filter((o) => (o as HTMLOptionElement).value !== 'Won');
    expect(others.every((o) => (o as HTMLOptionElement).disabled)).toBe(true);
  });

  it('keeps the panel and reason when the store rejects the change', () => {
    renderPage();
    fireEvent.click(col('Awaiting').getByText('Opp A1'));
    fireEvent.change(statusSelect(), { target: { value: 'Tender' } });
    const real = useCrmStore.getState().changePhase;
    act(() => { useCrmStore.setState({ changePhase: () => ({ ok: false, error: 'Cannot move quotation from Awaiting to Tender' }) }); });
    fireEvent.click(save());
    expect(phaseOf('A1')).toBe('Awaiting');
    expect(statusSelect().value).toBe('Tender');
    expect(screen.getByText('Cannot move quotation from Awaiting to Tender')).toBeTruthy();
    act(() => { useCrmStore.setState({ changePhase: real }); });
  });
});

describe('CRM drag and drop', () => {
  const dropOn = (cardId: string, target: string) => {
    const data: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '' };
    fireEvent.dragStart(screen.getByTestId(`card-${cardId}`), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId(`column-${target}`), { dataTransfer: dt });
  };

  it('applies an allowed drop through the same path', () => {
    renderPage();
    dropOn('A1', 'Tender');
    expect(phaseOf('A1')).toBe('Tender');
    expect(useCrmStore.getState().quotations.find((x) => x.id === 'A1')!.history).toHaveLength(2);
  });

  it('rejects a disallowed drop with the rule error and changes nothing', () => {
    renderPage();
    dropOn('A1', 'Won');
    expect(phaseOf('A1')).toBe('Awaiting');
    expect(toasts.error).toHaveBeenCalledWith('Cannot move quotation from Awaiting to Won');
  });

  it('asks for a reason when dropping on Lost', () => {
    renderPage();
    dropOn('A1', 'Lost');
    expect(phaseOf('A1')).toBe('Awaiting');
    expect(screen.getByText('Mark as Lost')).toBeTruthy();
  });
});
