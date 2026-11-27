// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: toasts.success, toastError: toasts.error, toastInfo: vi.fn(), toastWarning: vi.fn(),
}));
const api = vi.hoisted(() => ({
  machines: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), setOperationalStatus: vi.fn() },
  models: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  docs: { list: vi.fn(), create: vi.fn(), deactivate: vi.fn() },
  files: { upload: vi.fn(), get: vi.fn() },
  branches: { list: vi.fn() },
}));
vi.mock('@/services/api/machines', () => ({ machinesApi: api.machines }));
vi.mock('@/services/api/machineModels', () => ({ machineModelsApi: api.models }));
vi.mock('@/services/api/machineDocuments', () => ({ machineDocumentsApi: api.docs }));
vi.mock('@/services/api/files', () => ({ filesApi: api.files }));
vi.mock('@/services/api/company', () => ({ branchesApi: api.branches }));

import { useAuthStore, JA_ORG_ID, type AuthUser } from '@/store/authStore';
import { ApiClientError } from '@/services/api/http';
import {
  branchDto, machineDocDto, machineDto, modelDto, page, renderScreen, setSessionReady, staleError, unavailableError,
} from '@/test-support/apiScreens';
import { FleetPage } from './FleetPage';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { orgId: JA_ORG_ID, name: 'Tester', email: 't@example.com', role: 'Managing Director', isOwner: true } as unknown as AuthUser,
    isAuthenticated: true,
  });
  setSessionReady();
  api.machines.list.mockResolvedValue(page([machineDto('1'), machineDto('2', { operationalStatus: 'Under Repair' })]));
  api.models.list.mockResolvedValue(page([modelDto('m-1', 'JLG', '660SJ')]));
  api.branches.list.mockResolvedValue(page([branchDto('b-1', 'Dubai HQ')]));
  api.docs.list.mockResolvedValue({ items: [machineDocDto('d1', '1')], documentTypes: ['Certificate'] });
});
afterEach(cleanup);

async function fillRequired() {
  fireEvent.change(await screen.findByLabelText(/Fleet No/), { target: { value: 'J900' } });
  fireEvent.change(screen.getByLabelText(/Asset No/), { target: { value: 'A900' } });
  fireEvent.change(screen.getByLabelText(/Serial No/), { target: { value: 'SN900' } });
  await waitFor(() => expect(screen.getByRole('option', { name: /JLG 660SJ/ })).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: 'm-1' } });
  await waitFor(() => expect(screen.getByRole('option', { name: 'Dubai HQ' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/^Branch/), { target: { value: 'b-1' } });
  fireEvent.change(screen.getByLabelText(/Current location/), { target: { value: 'Yard 3' } });
}

describe('Fleet screen (API)', () => {
  it('shows a loading state, then the machines read from the API with their model and branch', async () => {
    api.machines.list.mockReturnValue(new Promise(() => {}));
    const { container } = renderScreen(<FleetPage />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    cleanup();

    api.machines.list.mockResolvedValue(page([machineDto('1'), machineDto('2', { operationalStatus: 'Under Repair' })]));
    renderScreen(<FleetPage />);
    expect(await screen.findByText('A-1')).toBeTruthy();
    expect(screen.getByText('A-2')).toBeTruthy();
    expect(screen.getAllByText('JLG 660SJ').length).toBeGreaterThan(0);
  });

  it('shows the service-unavailable message naming /api/v1 and no machines on 503', async () => {
    api.machines.list.mockRejectedValue(unavailableError());
    renderScreen(<FleetPage />);
    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('/api/v1');
    expect(screen.queryByText('A-1')).toBeNull();
  });

  it('creates a machine with the chosen model and branch and an idempotency submission id', async () => {
    api.machines.create.mockResolvedValue(machineDto('9'));
    renderScreen(<FleetPage />);
    await screen.findByText('A-1');
    fireEvent.click(screen.getByRole('button', { name: /add machine/i }));
    await fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Create Machine' }));

    await waitFor(() => expect(api.machines.create).toHaveBeenCalledTimes(1));
    const [body, submissionId] = api.machines.create.mock.calls[0];
    expect(body).toMatchObject({ fleetNo: 'J900', assetNo: 'A900', serialNo: 'SN900', modelId: 'm-1', branchId: 'b-1', currentLocation: 'Yard 3' });
    expect(typeof submissionId).toBe('string');
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Machine created'));
  });

  it('keeps the entered values and shows the message and correlation id when the API rejects the create', async () => {
    api.machines.create.mockRejectedValue(new ApiClientError({
      code: 'DUPLICATE', message: 'A machine with this asset, fleet or serial number already exists', status: 409, correlationId: 'corr-m',
      fieldErrors: { fleetNo: 'duplicate' },
    }));
    renderScreen(<FleetPage />);
    await screen.findByText('A-1');
    fireEvent.click(screen.getByRole('button', { name: /add machine/i }));
    await fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Create Machine' }));

    const err = await screen.findByTestId('api-error');
    expect(err.textContent).toContain('already exists');
    expect(err.textContent).toContain('corr-m');
    expect((screen.getByLabelText(/Fleet No/) as HTMLInputElement).value).toBe('J900');
    expect((screen.getByLabelText(/Serial No/) as HTMLInputElement).value).toBe('SN900');
  });

  it('on 409 STALE_VERSION offers a reload that refreshes the row version and keeps the entries', async () => {
    api.machines.update.mockRejectedValueOnce(staleError());
    api.machines.get.mockResolvedValue(machineDto('1', { rowVersion: 8 }));
    renderScreen(<FleetPage />);
    fireEvent.click(await screen.findByText('A-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const loc = await screen.findByLabelText(/Current location/);
    fireEvent.change(loc, { target: { value: 'Moved yard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await screen.findByText(/changed by someone else/i);
    expect(api.machines.update.mock.calls[0].slice(0, 2)).toEqual(['1', 4]);
    fireEvent.click(screen.getByRole('button', { name: /reload latest/i }));
    await waitFor(() => expect(screen.queryByTestId('api-error')).toBeNull());
    expect((screen.getByLabelText(/Current location/) as HTMLInputElement).value).toBe('Moved yard');

    api.machines.update.mockResolvedValue(machineDto('1', { rowVersion: 9 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.machines.update).toHaveBeenCalledTimes(2));
    expect(api.machines.update.mock.calls[1].slice(0, 2)).toEqual(['1', 8]);
  });

  it('lists the machine documents from the API in the machine panel', async () => {
    renderScreen(<FleetPage />);
    fireEvent.click(await screen.findByText('A-1'));
    expect(await screen.findByText('Doc d1')).toBeTruthy();
    expect(api.docs.list).toHaveBeenCalledWith('1', { active: true });
  });

  it('creates a machine model through the models dialog', async () => {
    api.models.create.mockResolvedValue(modelDto('m-2', 'Genie', 'Z-45'));
    renderScreen(<FleetPage />);
    await screen.findByText('A-1');
    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    fireEvent.change(await screen.findByLabelText(/^Make/), { target: { value: 'Genie' } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: 'Z-45' } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: 'Articulating Boom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
    await waitFor(() => expect(api.models.create).toHaveBeenCalledTimes(1));
    expect(api.models.create.mock.calls[0][0]).toMatchObject({ make: 'Genie', model: 'Z-45', category: 'Articulating Boom' });
  });
});
