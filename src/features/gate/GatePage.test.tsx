// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GateEntry } from '@/types/gate';

const state = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock('@/hooks/useQueries', () => ({
  useGateEntries: () => ({ data: state.entries, isLoading: false }),
  useApproveGateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteGateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useBranchFilter', () => ({ useBranchFilter: <T,>(x: T) => x }));
vi.mock('@/lib/toast-helper', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('./GatePassDialog', () => ({ GatePassDialog: () => null }));

import { GatePage } from './GatePage';
import { useAuthStore, rolePageAccess } from '@/store/authStore';
import type { UserRole } from '@/store/authStore';

const PAYLOAD = 'AXLEOPS-FLEET:org-1:m-1:FL-001';

function entry(over: Partial<GateEntry> = {}): GateEntry {
  return {
    id: 'g1',
    createdAt: '2025-01-15T08:30:00.000Z',
    updatedAt: '2025-01-15T08:30:00.000Z',
    reference: 'GATE-001',
    assetNumber: 'A-1',
    machineModel: 'CAT 320',
    direction: 'IN',
    timestamp: '2025-01-15T08:30:00.000Z',
    driver: 'Ali',
    destination: 'Dubai Yard',
    status: 'Pending',
    branchId: 'branch-dxb',
    branchName: 'Dubai',
    gatePass: 'GP-1',
    ...over,
  } as GateEntry;
}

function openDetail(e: GateEntry) {
  state.entries = [e];
  render(<GatePage />);
  fireEvent.click(screen.getByText(e.reference));
}

function rowValue(label: string): string | null {
  const dt = screen.queryByText(label, { selector: 'dt' });
  return dt ? (dt.nextElementSibling?.textContent ?? null) : null;
}

beforeEach(() => {
  state.entries = [];
});
afterEach(() => cleanup());

describe('GatePage detail panel', () => {
  it('shows all capture fields for a full record', () => {
    openDetail(entry({
      fleetNo: 'FL-001',
      gateDate: '2025-01-15',
      gateTime: '12:30:00',
      gateTimeZone: 'Asia/Dubai',
      captureMethod: 'Manual',
      timeSource: 'server',
    }));
    expect(rowValue('Fleet No.')).toBe('FL-001');
    expect(rowValue('Gate Date')).toBe('2025-01-15');
    expect(rowValue('Gate Time')).toBe('12:30:00 Asia/Dubai');
    expect(rowValue('Capture Method')).toBe('Manual');
    expect(rowValue('Time Source')).toBe('server');
    expect(rowValue('QR Payload')).toBeNull();
    expect(rowValue('Timestamp')).toBeNull();
    expect(rowValue('Truck Plate')).not.toBeNull();
    expect(rowValue('Gate Pass')).toBe('GP-1');
    expect(rowValue('Driver')).toBe('Ali');
    expect(rowValue('Branch')).toBe('Dubai');
  });

  it('derives date and time for a legacy record and shows "-" for missing fields', () => {
    openDetail(entry());
    expect(rowValue('Fleet No.')).toBe('A-1');
    expect(rowValue('Gate Date')).toBe('2025-01-15');
    expect(rowValue('Gate Time')).toBe('08:30:00 UTC');
    expect(rowValue('Capture Method')).toBe('-');
    expect(rowValue('Time Source')).toBe('-');
    expect(rowValue('QR Payload')).toBeNull();
  });

  it('appends "Device time" when the time source is device', () => {
    openDetail(entry({
      gateDate: '2025-01-15',
      gateTime: '12:30:00',
      gateTimeZone: 'Asia/Dubai',
      timeSource: 'device',
    }));
    expect(rowValue('Gate Time')).toBe('12:30:00 Asia/Dubai · Device time');
    expect(rowValue('Time Source')).toBe('device');
  });

  it('shows the full QR payload for a QR record', () => {
    openDetail(entry({ captureMethod: 'QR', qrPayload: PAYLOAD }));
    expect(rowValue('QR Payload')).toBe(PAYLOAD);
    expect(rowValue('Capture Method')).toBe('QR');
  });

  it('shows "Not available" for a QR record without payload', () => {
    openDetail(entry({ captureMethod: 'QR' }));
    expect(rowValue('QR Payload')).toBe('Not available');
  });

  it('shows "Not available" for date and time when dates are unparseable', () => {
    openDetail(entry({ timestamp: 'garbage', createdAt: 'also-bad' }));
    expect(rowValue('Gate Date')).toBe('Not available');
    expect(rowValue('Gate Time')).toBe('Not available');
  });
});

describe('/gate page access by role', () => {
  const allRoles = Object.keys(rolePageAccess) as UserRole[];
  const allowed: UserRole[] = [
    'Security',
    'Ops Executive',
    'Operations Manager',
    'Executive Manager',
    'Managing Director',
  ];

  it('covers all 16 roles', () => {
    expect(allRoles).toHaveLength(16);
  });

  it.each(allRoles.map((r) => [r, allowed.includes(r)] as const))(
    '%s -> %s',
    (role, expected) => {
      useAuthStore.setState({
        user: {
          id: 'u',
          name: 'T',
          email: 't@x.com',
          role,
          branchId: 'b',
          branchName: 'B',
          avatarColor: '#000',
        },
        isAuthenticated: true,
      } as never);
      expect(useAuthStore.getState().hasPageAccess('/gate')).toBe(expected);
    },
  );
});
