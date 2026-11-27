// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));
const api = vi.hoisted(() => ({
  quotations: { list: vi.fn(), history: vi.fn(), changePhase: vi.fn(), create: vi.fn() },
  customers: { list: vi.fn() },
  agreements: { list: vi.fn() },
  branches: { list: vi.fn() },
}));
vi.mock('@/services/api/quotations', () => ({ quotationsApi: api.quotations }));
vi.mock('@/services/api/customers', () => ({ customersApi: api.customers }));
vi.mock('@/services/api/hireAgreements', () => ({ hireAgreementsApi: api.agreements }));
vi.mock('@/services/api/company', () => ({ branchesApi: api.branches }));

import { useAuthStore, type AuthUser } from '@/store/authStore';
import { ApiClientError } from '@/services/api/http';
import type { QuotationPhase } from '../../../../shared/dto/index';
import {
  customerDto, historyDto, page, quotationDto, renderScreen, setSessionReady, staleError, unavailableError,
} from '@/test-support/apiScreens';
import { CrmPage } from '../CrmPage';

const ORG = 'org-pipe-test';

function setOrg(orgId: string) {
  useAuthStore.setState({
    user: { orgId, name: 'Tester', email: 't@example.com', role: 'Managing Director' } as unknown as AuthUser,
    isAuthenticated: true,
  });
}

const q = (id: string, phase: QuotationPhase, over = {}) => quotationDto(id, phase, over);
const col = (p: string) => within(screen.getByTestId(`column-${p}`));
const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const renderPage = () => renderScreen(<CrmPage />);
const openCard = async (column: string, text: string) => fireEvent.click((await screen.findAllByText(text)).find((el) => col(column).queryByText(text) === el)!);

beforeEach(() => {
  vi.clearAllMocks();
  setOrg(ORG);
  setSessionReady();
  api.quotations.list.mockResolvedValue(page([
    q('A1', 'AWAITING'), q('T1', 'TENDER'), q('L1', 'LOST', { lostReason: 'x' }), q('W1', 'WON'),
  ]));
  api.quotations.history.mockResolvedValue({ items: [historyDto('h1', 'A1', null, 'AWAITING')] });
  api.quotations.changePhase.mockImplementation(async (id: string, _v: number, input: { toPhase: QuotationPhase }) => q(id, input.toPhase));
  api.customers.list.mockResolvedValue(page([customerDto()]));
  api.agreements.list.mockResolvedValue(page([]));
  api.branches.list.mockResolvedValue(page([]));
});
afterEach(cleanup);

describe('CRM pipeline board (API)', () => {
  it('shows a loading state while the quotations load', () => {
    api.quotations.list.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByTestId('column-Awaiting')).toBeNull();
  });

  it('shows four columns in order with counts and amounts and no per-card buttons', async () => {
    renderPage();
    await screen.findByTestId('column-Awaiting');
    const heads = ['Awaiting', 'Tender', 'Lost', 'Won'];
    const cols = screen.getAllByTestId(/^column-/).map((c) => c.getAttribute('data-testid'));
    expect(cols).toEqual(heads.map((h) => `column-${h}`));
    for (const h of heads) {
      expect(screen.getByTestId(`count-${h}`).textContent).toBe('1');
      expect(screen.getByTestId(`amount-${h}`).textContent).toBe('AED 1,000');
    }
    expect(screen.queryByRole('button', { name: /^(Tender|Won|Lost)$/ })).toBeNull();
    expect(screen.getAllByText('ABC Company LLC').length).toBeGreaterThan(0);
  });

  it('shows empty-column text and keeps the column visible', async () => {
    api.quotations.list.mockResolvedValue(page([q('A1', 'AWAITING')]));
    renderPage();
    await screen.findByTestId('column-Won');
    expect(col('Won').getByText('No quotations')).toBeTruthy();
    expect(screen.getByTestId('amount-Won').textContent).toBe('AED 0');
  });
});

describe('CRM Status panel (API)', () => {
  it('opens on card click, replaces on another click and closes', async () => {
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    expect(screen.getAllByTestId('status-editor')).toHaveLength(1);
    expect(screen.getByText('QT-2026-A1 · ABC Company LLC')).toBeTruthy();
    fireEvent.click(col('Tender').getByText('Opp T1'));
    expect(screen.getAllByTestId('status-editor')).toHaveLength(1);
    expect(screen.getByText('QT-2026-T1 · ABC Company LLC')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('status-editor')).toBeNull();
    expect(screen.getAllByTestId(/^column-/)).toHaveLength(4);
  });

  it('offers the manual Awaiting to Won action and keeps Save disabled until a different allowed status is chosen', async () => {
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    expect(statusSelect().value).toBe('Awaiting');
    expect(save().disabled).toBe(true);
    const won = within(statusSelect()).getByRole('option', { name: /Won/ }) as HTMLOptionElement;
    expect(won.disabled).toBe(false);
    fireEvent.change(statusSelect(), { target: { value: 'Tender' } });
    expect(save().disabled).toBe(false);
  });

  it('moves Awaiting to Won without a reason, sending the row version and an idempotency submission id', async () => {
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    fireEvent.change(statusSelect(), { target: { value: 'Won' } });
    expect(screen.queryByLabelText('Reason')).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(api.quotations.changePhase).toHaveBeenCalledTimes(1));
    const [id, rowVersion, input, submissionId] = api.quotations.changePhase.mock.calls[0];
    expect([id, rowVersion, input]).toEqual(['A1', 5, { toPhase: 'WON' }]);
    expect(typeof submissionId).toBe('string');
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it('saves a move and reloads the list; the panel shows the phase history from the API', async () => {
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    await screen.findByText('Created as Awaiting');
    api.quotations.list.mockResolvedValue(page([
      q('A1', 'TENDER', { rowVersion: 6 }), q('T1', 'TENDER'), q('L1', 'LOST', { lostReason: 'x' }), q('W1', 'WON'),
    ]));
    api.quotations.history.mockResolvedValue({ items: [historyDto('h1', 'A1', null, 'AWAITING'), historyDto('h2', 'A1', 'AWAITING', 'TENDER')] });
    fireEvent.change(statusSelect(), { target: { value: 'Tender' } });
    fireEvent.click(save());
    await waitFor(() => expect(col('Tender').getByText('Opp A1')).toBeTruthy());
    await waitFor(() => expect(statusSelect().value).toBe('Tender'));
    expect(save().disabled).toBe(true);
    await screen.findByText('Awaiting → Tender');
  });

  it('requires a reason for Lost and sends it', async () => {
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    fireEvent.change(statusSelect(), { target: { value: 'Lost' } });
    expect(screen.getByRole('alert').textContent).toMatch(/reason is required/i);
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    expect(save().disabled).toBe(true);
    expect(api.quotations.changePhase).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Price too high' } });
    fireEvent.click(save());
    await waitFor(() => expect(api.quotations.changePhase).toHaveBeenCalled());
    expect(api.quotations.changePhase.mock.calls[0][2]).toEqual({ toPhase: 'LOST', reason: 'Price too high' });
  });

  it('requires a reason to reopen a Lost quotation', async () => {
    renderPage();
    await openCard('Lost', 'Opp L1');
    fireEvent.change(statusSelect(), { target: { value: 'Awaiting' } });
    expect(screen.getByRole('alert').textContent).toMatch(/reason is required/i);
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer came back' } });
    fireEvent.click(save());
    await waitFor(() => expect(api.quotations.changePhase).toHaveBeenCalled());
    expect(api.quotations.changePhase.mock.calls[0][2]).toEqual({ toPhase: 'AWAITING', reason: 'Customer came back' });
  });

  it('disables every other option for a Won quotation', async () => {
    renderPage();
    await openCard('Won', 'Opp W1');
    const others = within(statusSelect()).getAllByRole('option').filter((o) => (o as HTMLOptionElement).value !== 'Won');
    expect(others.every((o) => (o as HTMLOptionElement).disabled)).toBe(true);
  });

  it('keeps the panel and the reason, and shows the message and correlation id, when the API rejects the change', async () => {
    api.quotations.changePhase.mockRejectedValue(new ApiClientError({
      code: 'INVALID_TRANSITION', message: 'Cannot move quotation from Awaiting to Lost', status: 422, correlationId: 'corr-422',
    }));
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    fireEvent.change(statusSelect(), { target: { value: 'Lost' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Price too high' } });
    fireEvent.click(save());
    await screen.findByTestId('api-error');
    expect(screen.getByTestId('api-error').textContent).toContain('Cannot move quotation from Awaiting to Lost');
    expect(screen.getByTestId('api-error').textContent).toContain('corr-422');
    expect(statusSelect().value).toBe('Lost');
    expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe('Price too high');
    expect(toasts.error).toHaveBeenCalled();
  });

  it('on 409 STALE_VERSION shows a conflict message, offers a reload and keeps the entered reason', async () => {
    api.quotations.changePhase.mockRejectedValue(staleError());
    renderPage();
    await openCard('Awaiting', 'Opp A1');
    fireEvent.change(statusSelect(), { target: { value: 'Lost' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Price too high' } });
    fireEvent.click(save());
    await screen.findByText(/changed by someone else/i);
    const reload = screen.getByRole('button', { name: /reload latest/i });
    const listCalls = api.quotations.list.mock.calls.length;
    fireEvent.click(reload);
    await waitFor(() => expect(api.quotations.list.mock.calls.length).toBeGreaterThan(listCalls));
    expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe('Price too high');
  });
});

describe('CRM drag and drop (API)', () => {
  const dropOn = (cardId: string, target: string) => {
    const data: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '' };
    fireEvent.dragStart(screen.getByTestId(`card-${cardId}`), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId(`column-${target}`), { dataTransfer: dt });
  };

  it('applies an allowed drop through the same API call', async () => {
    renderPage();
    await screen.findByTestId('card-A1');
    dropOn('A1', 'Tender');
    await waitFor(() => expect(api.quotations.changePhase).toHaveBeenCalled());
    expect(api.quotations.changePhase.mock.calls[0].slice(0, 3)).toEqual(['A1', 5, { toPhase: 'TENDER' }]);
  });

  it('rejects a disallowed drop with the rule error and calls nothing', async () => {
    renderPage();
    await screen.findByTestId('card-T1');
    dropOn('T1', 'Awaiting');
    expect(api.quotations.changePhase).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith('Cannot move quotation from Tender to Awaiting');
  });

  it('asks for a reason when dropping on Lost', async () => {
    renderPage();
    await screen.findByTestId('card-A1');
    dropOn('A1', 'Lost');
    expect(api.quotations.changePhase).not.toHaveBeenCalled();
    expect(screen.getByText('Mark as Lost')).toBeTruthy();
  });
});

describe('CRM errors (API)', () => {
  it('shows the service-unavailable message naming /api/v1 and no mock data on 503', async () => {
    api.quotations.list.mockRejectedValue(unavailableError());
    renderPage();
    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('/api/v1');
    expect(err.textContent).toContain('corr-503');
    expect(screen.queryByTestId('column-Awaiting')).toBeNull();
    expect(screen.queryByText(/^Opp /)).toBeNull();
  });

  it('shows a connection error that names /api/v1 when the session could not start', async () => {
    const { useSessionStore } = await import('@/services/api/session');
    useSessionStore.setState({
      status: 'error', session: null, devFixtureAuth: false,
      error: 'The service is unavailable. Check that the backend is running and reachable at /api/v1, then try again.',
    });
    renderPage();
    expect((await screen.findByTestId('api-error')).textContent).toContain('/api/v1');
    expect(api.quotations.list).not.toHaveBeenCalled();
  });
});
