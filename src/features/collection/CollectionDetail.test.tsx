// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/features/fleet/MachineQrPanel', () => ({ MachineQrPanel: () => null }));
vi.mock('@/services/collectionPdf', () => ({ collectionNotePdf: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

let notes: unknown[] = [];
const pickedUp = vi.fn();
const cancel = vi.fn();
const update = vi.fn();
vi.mock('@/hooks/api/useCollectionApi', () => ({
  useCollectionNotes: () => ({ data: notes, isLoading: false, refetch: vi.fn() }),
  useOwnerDocuments: () => ({ data: [] }),
  useUpdateCollectionNote: () => ({ mutate: update, isPending: false }),
  useMarkPickedUp: () => ({ mutate: pickedUp, isPending: false }),
  useCancelCollection: () => ({ mutate: cancel, isPending: false }),
  useAttachSignedCopy: () => ({ mutate: vi.fn(), isPending: false }),
  useStoreGeneratedPdf: () => ({ mutate: vi.fn(), isPending: false }),
  activeSignedCopy: () => undefined,
  docSnapshot: (d: unknown) => d,
  fetchCollectionNote: vi.fn(),
  openStoredFile: vi.fn(),
}));

import { CollectionDetail } from './CollectionDetail';
import type { CollectionNote, CollectionStatus } from '@/types/collection';

function note(status: CollectionStatus, extra: Partial<CollectionNote> = {}): CollectionNote {
  return {
    id: 'cn-1',
    orgId: 'org-ja',
    number: 'CN-2026-0001',
    status,
    date: '2026-11-01',
    collectionAddress: 'Site A',
    driver: '',
    vehicle: '',
    remarks: '',
    customerName: 'ACME',
    machineId: 'mc-1',
    fleetNo: 'J101',
    serialNumber: 'SN1',
    machineDescription: 'Excavator',
    bookingRef: 'BK-1',
    hireAgreementNo: '',
    quotationNo: '',
    invoiceNo: '',
    site: '',
    missing: [],
    refNotes: [],
    signedStatus: 'Pending',
    rowVersion: 4,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  } as unknown as CollectionNote;
}

function renderNote(n: CollectionNote) {
  notes = [n];
  return render(
    <MemoryRouter>
      <CollectionDetail noteId={n.id} />
    </MemoryRouter>,
  );
}

describe('CollectionDetail actions', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    notes = [];
    pickedUp.mockReset();
    cancel.mockReset();
    update.mockReset();
  });

  it('Draft and Scheduled notes can be picked up and cancelled', () => {
    for (const s of ['Draft', 'Scheduled'] as const) {
      const { unmount } = renderNote(note(s));
      expect(screen.getByRole('button', { name: /Mark Picked Up/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Cancel collection/ })).toBeTruthy();
      unmount();
    }
  });

  it('Picked Up sends the row version to the picked-up action (not a gate receipt)', () => {
    renderNote(note('Scheduled'));
    fireEvent.click(screen.getByRole('button', { name: /Mark Picked Up/ }));
    expect(pickedUp.mock.calls[0][0]).toEqual({ id: 'cn-1', rowVersion: 4 });
    expect(screen.getByText(/Picked Up records the truck pickup only/)).toBeTruthy();
  });

  it('cancel needs a reason', () => {
    renderNote(note('Draft'));
    fireEvent.click(screen.getByRole('button', { name: /Cancel collection/ }));
    const confirm = screen.getByRole('button', { name: 'Confirm cancel' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Customer extended' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
    expect(cancel.mock.calls[0][0]).toEqual({ id: 'cn-1', rowVersion: 4, reason: 'Customer extended' });
  });

  it('a Picked Up note cannot be picked up again but can be cancelled', () => {
    renderNote(note('Picked Up', { pickedUpAt: '2026-11-02T08:00:00.000Z' }));
    expect(screen.queryByRole('button', { name: /Mark Picked Up/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Cancel collection/ })).toBeTruthy();
    expect(screen.getByTestId('cn-status-badge').textContent).toBe('Picked Up');
  });

  it.each<CollectionStatus>(['Collected', 'Closed', 'Cancelled'])('%s is read-only', (s) => {
    renderNote(note(s));
    expect(screen.queryByRole('button', { name: /Mark Picked Up/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancel collection/ })).toBeNull();
    expect((screen.getByLabelText('Remarks') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('shows the collected time and a link to /gate for a collected note', () => {
    renderNote(note('Collected', { collectedAt: '2026-11-28T10:20:00.000Z' }));
    const row = screen.getByTestId('cn-collected-at-gate');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/gate');
  });

  it('Save sends only the changed fields with the row version', () => {
    renderNote(note('Draft'));
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update.mock.calls[0][0]).toEqual({ id: 'cn-1', rowVersion: 4, patch: { remarks: 'updated' } });
  });
});
