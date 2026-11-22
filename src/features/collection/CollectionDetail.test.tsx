// @vitest-environment jsdom
import { createContext, useContext, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/features/fleet/MachineQrPanel', () => ({ MachineQrPanel: () => null }));
vi.mock('@/services/collectionPdf', () => ({ collectionNotePdf: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('@/services/signedFiles', () => ({ attachSigned: vi.fn(), getSignedFile: vi.fn() }));
vi.mock('@/lib/toast-helper', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

// Radix Select does not open in jsdom; use a flat stand-in that lists its options.
vi.mock('@/components/ui/select', () => {
  const Ctx = createContext<(v: string) => void>(() => undefined);
  return {
    Select: ({ onValueChange, children }: { onValueChange: (v: string) => void; children: ReactNode }) => (
      <div data-testid="status-select">
        <button type="button" data-testid="force-collected" onClick={() => onValueChange('Collected')} />
        <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
      </div>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
    SelectItem: function Item({ value, children }: { value: string; children: ReactNode }) {
      const on = useContext(Ctx);
      return (
        <li role="option" aria-selected={false} onClick={() => on(value)}>
          {children}
        </li>
      );
    },
  };
});

import { CollectionDetail } from './CollectionDetail';
import { useCollectionStore } from '@/store/collectionStore';
import type { CollectionNote, CollectionStatus } from '@/types/collection';

const HINT = 'Collected is set automatically at Gate-In in Gate Operations';

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
    bookingRef: '',
    hireAgreementNo: '',
    quotationNo: '',
    invoiceNo: '',
    site: '',
    missing: [],
    refNotes: [],
    signedStatus: 'Unsigned',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  } as unknown as CollectionNote;
}

function renderNote(n: CollectionNote) {
  useCollectionStore.setState({ notes: [n] });
  return render(
    <MemoryRouter>
      <CollectionDetail noteId={n.id} />
    </MemoryRouter>,
  );
}

const optionTexts = () => screen.queryAllByRole('option').map((o) => o.textContent);

describe('CollectionDetail status control', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    useCollectionStore.setState({ notes: [] });
  });

  it.each<CollectionStatus>(['Draft', 'Scheduled'])('%s offers only Draft and Scheduled', (s) => {
    renderNote(note(s));
    expect(optionTexts()).toEqual(['Draft', 'Scheduled']);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('Collected is read-only and offers only Closed', () => {
    renderNote(note('Collected'));
    expect(optionTexts()).toEqual(['Closed']);
    expect(screen.getByTestId('cn-status-badge').textContent).toBe('Collected');
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('Closed is read-only with no options', () => {
    renderNote(note('Closed'));
    expect(optionTexts()).toEqual([]);
    expect(screen.getByTestId('cn-status-badge').textContent).toBe('Closed');
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('shows the gate reference and a link to /gate only when the link is present', () => {
    const { unmount } = renderNote(
      note('Collected', { collectedByGateId: 'ge-1', collectedByGateRef: 'GP-0421', collectedAt: '2026-11-28T10:20:00.000Z' }),
    );
    const row = screen.getByTestId('cn-collected-at-gate');
    expect(row.textContent).toContain('GP-0421');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/gate');
    unmount();

    renderNote(note('Collected'));
    expect(screen.queryByTestId('cn-collected-at-gate')).toBeNull();
  });

  it('Save never writes Collected', () => {
    renderNote(note('Draft'));
    fireEvent.click(screen.getByTestId('force-collected'));
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useCollectionStore.getState().notes[0];
    expect(saved.status).toBe('Draft');
    expect(saved.remarks).toBe('updated');
  });
});
