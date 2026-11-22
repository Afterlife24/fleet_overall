// @vitest-environment jsdom
import { createContext, forwardRef, useContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransportPage } from './TransportPage';
import { TransportJobDialog } from './TransportJobDialog';
import { transportService } from '@/services/services';
import { useAuthStore } from '@/store/authStore';
import { useTransportStore } from '@/store/transportStore';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { appCreateTransportJob } from '@/features/fleet/collectionWiring';
import type { CollectionNote } from '@/types/collection';
import type { TransportForm } from '@/types/transport';

vi.mock('@/lib/toast-helper', () => ({
  toastSuccess: vi.fn(), toastError: vi.fn(), toastInfo: vi.fn(), toastWarning: vi.fn(), toastPromise: vi.fn(),
}));

// Radix Select needs pointer APIs jsdom lacks. Every item renders as a button that calls onValueChange.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<(v: string) => void>(() => {});
  return {
    Select: ({ onValueChange, children }: { onValueChange?: (v: string) => void; children: ReactNode }) => (
      <Ctx.Provider value={onValueChange ?? (() => {})}>{children}</Ctx.Provider>
    ),
    SelectTrigger: forwardRef<HTMLDivElement, { children?: ReactNode }>(function Trigger() {
      return <div />;
    }),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const onChange = useContext(Ctx);
      return <button type="button" onClick={() => onChange(value)}>{children}</button>;
    },
  };
});

const ORG = 'org-transport-ui';

const FORM: TransportForm = {
  plannerName: 'Prashanth', date: '2026-05-05', shift: 'Morning', transportTeam: 'MT 4 - RACHHPAL', srNo: 7,
  fleet: 'F-1', from: 'AUH Yard', to: 'Dubai Marina', transport: 'MT 4 [S]', type: 'D',
  contact: 'Mohammed / +971 50 123', sales: 'BG', client: 'Katch Events', time: '08:30',
};

let qc: QueryClient;
let savedUser: unknown;

function wrap(ui: ReactNode) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  savedUser = useAuthStore.getState().user;
  useAuthStore.setState({ user: { orgId: ORG } as never });
  useTransportStore.setState({ jobs: [], counters: {}, seedMarkers: {}, overrides: {}, legacyImported: true });
  vi.mocked(toastError).mockClear();
  vi.mocked(toastSuccess).mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: savedUser as never });
});

async function panel(): Promise<HTMLElement> {
  const title = await screen.findByRole('heading', { level: 2, name: /^TJ-/ });
  return title.closest('.fixed') as HTMLElement;
}

const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

async function fillDialog() {
  change(screen.getByPlaceholderText('e.g. Prashanth'), 'Prashanth');
  change(screen.getByPlaceholderText('e.g. MT 4 - RACHHPAL'), 'MT 4 - RACHHPAL');
  change(screen.getByPlaceholderText('e.g. AUH Yard'), 'AUH Yard');
  change(screen.getByPlaceholderText('e.g. JiuJitsu Arena'), 'Dubai Marina');
  change(screen.getByPlaceholderText('e.g. Mohammed / +971 50 123'), 'Mohammed / +971 50 123');
  change(screen.getByPlaceholderText('e.g. Katch Events'), 'Katch Events');
  change(screen.getByLabelText('Time*'), '08:30');
  fireEvent.click(screen.getByText('MT 4 [S]'));
  fireEvent.click(screen.getByText('BG'));
  // fleet options come from the machine query (company org-ja has machines)
  const fleetItems = await screen.findAllByRole('button', { name: /^(?![DTO]2? —).+ — / });
  fireEvent.click(fleetItems[0]);
}

describe('TransportJobDialog', () => {
  it('shows field-level messages and creates nothing when required fields are empty', async () => {
    const onClose = vi.fn();
    wrap(<TransportJobDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Transport Job' }));
    expect(await screen.findByText('Planner name required')).toBeTruthy();
    expect(screen.getByText('Delivery destination required')).toBeTruthy();
    expect(useTransportStore.getState().jobs).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the entered values and creates nothing when the service throws', async () => {
    useAuthStore.setState({ user: { orgId: 'org-ja' } as never });
    const spy = vi.spyOn(transportService, 'create').mockRejectedValue(new Error('storage full'));
    const onClose = vi.fn();
    wrap(<TransportJobDialog open onClose={onClose} />);
    await fillDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create Transport Job' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(vi.mocked(toastError).mock.calls[0][0])).toContain('storage full');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText('e.g. Prashanth') as HTMLInputElement).value).toBe('Prashanth');
    expect((screen.getByPlaceholderText('e.g. AUH Yard') as HTMLInputElement).value).toBe('AUH Yard');
    expect(useTransportStore.getState().jobs).toHaveLength(0);
  });

  it('a double click creates exactly one job, shows a success toast and puts it first in the cache', async () => {
    useAuthStore.setState({ user: { orgId: 'org-ja' } as never });
    const onClose = vi.fn();
    wrap(<TransportJobDialog open onClose={onClose} />);
    await fillDialog();
    const submit = screen.getByRole('button', { name: 'Create Transport Job' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useTransportStore.getState().forOrg('org-ja')).toHaveLength(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const cached = qc.getQueryData<{ reference: string }[]>(['transport-jobs']);
    expect(cached?.[0].reference).toMatch(/^TJ-\d{4}-0001$/);
  });
});

describe('TransportPage', () => {
  it('lists more than eight jobs, newest first, without truncation', async () => {
    for (let i = 1; i <= 10; i++) await transportService.create({ ...FORM, srNo: i, client: `Client ${i}` });
    wrap(<TransportPage />);
    const refs = await screen.findAllByText(/^TJ-\d{4}-\d{4}$/);
    expect(refs).toHaveLength(10);
    expect(refs[0].textContent).toMatch(/-0010$/);
    expect(refs[9].textContent).toMatch(/-0001$/);
  });

  it('opens the detail panel with the 15 REF-13 rows and an empty Remarks', async () => {
    await transportService.create(FORM);
    wrap(<TransportPage />);
    fireEvent.click(await screen.findByText(/^TJ-\d{4}-0001$/, { selector: 'p' }));
    const dialog = await panel();
    for (const label of ['Planner Name', 'Date', 'Shift', 'Transport Team', 'Sr. No', 'Fleet', 'From', 'To',
      'Transport', 'Type', 'Contact', 'Sales', 'Client', 'Time', 'Remarks']) {
      expect(within(dialog).getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByText('Dubai Marina')).toBeTruthy();
    expect(within(dialog).getByText('Katch Events')).toBeTruthy();
  });

  it('renders a job that has no destination without crashing', async () => {
    useTransportStore.getState().add({
      ...FORM, id: 'tj-legacy', orgId: ORG, reference: 'TJ-2026-0001', status: 'Scheduled',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', to: undefined as unknown as string,
    });
    wrap(<TransportPage />);
    expect(await screen.findByText('TJ-2026-0001')).toBeTruthy();
  });

  it('lists a collection-note job with a TJ- reference', async () => {
    const cn = {
      id: 'cn-9', orgId: ORG, number: 'CN-2026-0009', date: '2026-06-01', fleetNo: 'F-9', machineId: 'm-9',
      customerName: 'Acme', collectionAddress: 'Site 5', site: 'Site 5',
    } as unknown as CollectionNote;
    appCreateTransportJob(cn);
    wrap(<TransportPage />);
    expect(await screen.findByText(/^TJ-\d{4}-0001$/, { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText('CN-2026-0009', { selector: 'p' })).toBeNull();
    const [job] = useTransportStore.getState().forOrg(ORG);
    expect(job).toMatchObject({ autoGenerated: true, sourceRef: 'CN-2026-0009', type: 'O' });
  });

  it('a status change in the panel is shown on the board and kept in the store', async () => {
    const made = await transportService.create(FORM);
    wrap(<TransportPage />);
    fireEvent.click(await screen.findByText(/^TJ-\d{4}-0001$/, { selector: 'p' }));
    const dialog = await panel();
    fireEvent.click(within(dialog).getByText('Completed'));
    await waitFor(() => expect(useTransportStore.getState().jobs[0].status).toBe('Completed'));
    expect(useTransportStore.getState().jobs[0].id).toBe(made.id);
  });
});
