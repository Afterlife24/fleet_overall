// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));
const api = vi.hoisted(() => ({
  lpos: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  files: { upload: vi.fn(), get: vi.fn() },
  quotations: { list: vi.fn() },
  customers: { list: vi.fn() },
  agreements: { list: vi.fn() },
  branches: { list: vi.fn() },
}));
vi.mock('@/services/api/customerLpos', () => ({ customerLposApi: api.lpos }));
vi.mock('@/services/api/files', () => ({ filesApi: api.files }));
vi.mock('@/services/api/quotations', () => ({ quotationsApi: api.quotations }));
vi.mock('@/services/api/customers', () => ({ customersApi: api.customers }));
vi.mock('@/services/api/hireAgreements', () => ({ hireAgreementsApi: api.agreements }));
vi.mock('@/services/api/company', () => ({ branchesApi: api.branches }));

import { LpoPage } from './LpoPage';
import {
  agreementDto, branchDto, customerDto, lpoDto, page, quotationDto, renderScreen, setSessionReady, staleError, unavailableError,
  validationError,
} from '@/test-support/apiScreens';

async function openNewForm() {
  fireEvent.click(await screen.findByRole('button', { name: /new lpo/i }));
  await screen.findByText('New LPO', { selector: '[role="dialog"] *' });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSessionReady();
  api.lpos.list.mockResolvedValue(page([lpoDto('l1', 'q1')]));
  api.quotations.list.mockResolvedValue(page([quotationDto('q1', 'WON')]));
  api.customers.list.mockResolvedValue(page([customerDto()]));
  api.agreements.list.mockResolvedValue(page([agreementDto('ha1', 'q1')]));
  api.branches.list.mockResolvedValue(page([branchDto('b-1', 'Dubai HQ')]));
});
afterEach(cleanup);

describe('LPO page (API)', () => {
  it('shows a loading state, then lists the LPOs with their quotation and customer', async () => {
    api.lpos.list.mockReturnValue(new Promise(() => {}));
    const { container } = renderScreen(<LpoPage />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    cleanup();
    api.lpos.list.mockResolvedValue(page([lpoDto('l1', 'q1')]));
    renderScreen(<LpoPage />);
    expect(await screen.findByText('LPO-l1')).toBeTruthy();
    expect(await screen.findByText('QT-2026-q1')).toBeTruthy();
  });

  it('creates an LPO for the selected quotation with an idempotency submission id', async () => {
    api.lpos.create.mockResolvedValue(lpoDto('l2', 'q1', { lpoNo: 'PO-77' }));
    renderScreen(<LpoPage />);
    await openNewForm();
    await waitFor(() => expect(screen.getByRole('option', { name: /QT-2026-q1/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Quotation/), { target: { value: 'q1' } });
    fireEvent.change(screen.getByLabelText(/LPO number/), { target: { value: 'PO-77' } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '450' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create LPO' }));

    await waitFor(() => expect(api.lpos.create).toHaveBeenCalledTimes(1));
    const [body, submissionId] = api.lpos.create.mock.calls[0];
    expect(body).toMatchObject({ quotationId: 'q1', customerId: 'c-1', lpoNo: 'PO-77', amount: '450' });
    expect(body).not.toHaveProperty('fileId');
    expect(typeof submissionId).toBe('string');
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('LPO created'));
  });

  it('uploads the optional file and attaches it once the scan reports Clean', async () => {
    api.files.upload.mockResolvedValue({ id: 'f-9', scanStatus: 'Pending' });
    api.files.get.mockResolvedValue({ id: 'f-9', scanStatus: 'Clean' });
    api.lpos.create.mockResolvedValue(lpoDto('l3', 'q1', { fileId: 'f-9' }));
    renderScreen(<LpoPage />);
    await openNewForm();
    await waitFor(() => expect(screen.getByRole('option', { name: /QT-2026-q1/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Quotation/), { target: { value: 'q1' } });
    fireEvent.change(screen.getByLabelText(/LPO number/), { target: { value: 'PO-1' } });
    const file = new File(['%PDF-1.4'], 'lpo.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/LPO file/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Create LPO' }));

    await waitFor(() => expect(api.lpos.create).toHaveBeenCalledTimes(1));
    expect(api.files.upload).toHaveBeenCalledTimes(1);
    expect(api.lpos.create.mock.calls[0][0]).toMatchObject({ fileId: 'f-9' });
  });

  it('keeps the form values and shows the field error and correlation id when the API rejects the create', async () => {
    api.lpos.create.mockRejectedValue(validationError());
    renderScreen(<LpoPage />);
    await openNewForm();
    await waitFor(() => expect(screen.getByRole('option', { name: /QT-2026-q1/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Quotation/), { target: { value: 'q1' } });
    fireEvent.change(screen.getByLabelText(/LPO number/), { target: { value: 'PO-keep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create LPO' }));

    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('Check the entered values');
    expect(err.textContent).toContain('corr-422');
    expect((screen.getByLabelText(/LPO number/) as HTMLInputElement).value).toBe('PO-keep');
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('edits an LPO with the row version as the precondition and offers a reload on 409', async () => {
    api.lpos.update.mockRejectedValueOnce(staleError());
    api.lpos.get.mockResolvedValue(lpoDto('l1', 'q1', { rowVersion: 6 }));
    renderScreen(<LpoPage />);
    fireEvent.click(await screen.findByText('LPO-l1'));
    await screen.findByText('Edit LPO LPO-l1');
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await screen.findByText(/changed by someone else/i);
    expect(api.lpos.update.mock.calls[0].slice(0, 2)).toEqual(['l1', 1]);
    fireEvent.click(screen.getByRole('button', { name: /reload latest/i }));
    await waitFor(() => expect(screen.queryByTestId('api-error')).toBeNull());
    expect((screen.getByLabelText(/Amount/) as HTMLInputElement).value).toBe('1000');

    api.lpos.update.mockResolvedValue(lpoDto('l1', 'q1', { rowVersion: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.lpos.update).toHaveBeenCalledTimes(2));
    expect(api.lpos.update.mock.calls[1].slice(0, 2)).toEqual(['l1', 6]);
  });

  it('shows the service-unavailable message naming /api/v1 and no LPOs on 503', async () => {
    api.lpos.list.mockRejectedValue(unavailableError());
    renderScreen(<LpoPage />);
    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('/api/v1');
    expect(screen.queryByText('LPO-l1')).toBeNull();
  });
});
