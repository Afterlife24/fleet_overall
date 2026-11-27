import { create } from 'zustand';
import { Booking } from '@/types/booking';

// Deterministic color palette — hash customerId → consistent color
const CUSTOMER_COLORS = [
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // rose
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#a855f7', // purple
];

export function getCustomerColor(customerId: string): string {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = customerId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return CUSTOMER_COLORS[Math.abs(hash) % CUSTOMER_COLORS.length];
}

/**
 * Planning status for a new or edited booking from its gates and the reserved flag. It never returns On Hire or
 * Returned: the server sets On Hire through Start Hire and Returned from the machine's return (`returnedAt`).
 */
export function computeBookingStatus(booking: {
  quoted?: boolean;
  haSent?: boolean;
  haReceived?: boolean;
  lpoNumber?: string;
  lpoValidityDate?: string;
  lpoId?: string;
  reserved?: boolean;
  startDate?: string;
  endDate?: string;
}): 'Reserved' | 'Allocated' {
  const gatesComplete =
    !!booking.quoted &&
    !!booking.haSent &&
    !!booking.haReceived &&
    (!!booking.lpoId || (!!booking.lpoNumber && !!booking.lpoValidityDate));
  return booking.reserved || !gatesComplete ? 'Reserved' : 'Allocated';
}

// Compute total value: dailyRate × days (display only; the server computes the stored total)
export function computeTotalValue(dailyRate: number, startDate: string, endDate: string): number {
  if (!startDate || !endDate || !dailyRate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return parseFloat((dailyRate * days).toFixed(2));
}

interface BookingState {
  /**
   * In-memory read copy of the bookings for the retained browser screens (invoices, collection, gate, transport).
   * The API is the authority: `services/api/bookingMirror.mirrorBookings` replaces this list on every refresh.
   * It is never persisted or seeded. The Planner reads and writes through `bookingsApi`.
   */
  userBookings: Booking[];
  addBooking: (booking: Booking) => void;
  updateBooking: (id: string, booking: Partial<Booking>) => void;
  deleteBooking: (id: string) => void;
  getAllBookings: () => Booking[];
}

// Bookings used to be persisted here; remove the stale browser copy once.
try {
  if (typeof localStorage !== 'undefined') localStorage.removeItem('fleet-bookings-v1');
} catch {
  // storage unavailable
}

export const useBookingStore = create<BookingState>()((set, get) => ({
  userBookings: [],

  addBooking: (booking) => set((state) => ({ userBookings: [...state.userBookings, booking] })),

  updateBooking: (id, data) => {
    // A stray id in the patch must never overwrite the record id.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _ignored, ...rest } = data;
    set((state) => ({
      userBookings: state.userBookings.map((b) => (b.id === id ? { ...b, ...rest, updatedAt: new Date().toISOString() } : b)),
    }));
  },

  deleteBooking: (id) => set((state) => ({ userBookings: state.userBookings.filter((b) => b.id !== id) })),

  getAllBookings: () => get().userBookings,
}));
