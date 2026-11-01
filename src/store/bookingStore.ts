import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Booking } from '@/types/booking';
import { bookings as mockBookings } from '@/services/mock/bookings';

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

// Compute booking status from gates + reserved flag
export function computeBookingStatus(booking: {
  quoted?: boolean;
  haSent?: boolean;
  haReceived?: boolean;
  lpoNumber?: string;
  lpoValidityDate?: string;
  reserved?: boolean;
  startDate: string;
  endDate: string;
}): Booking['status'] {
  const today = new Date();
  const start = new Date(booking.startDate);
  const end = new Date(booking.endDate);

  if (end < today) return 'Returned';

  const gatesComplete =
    !!booking.quoted &&
    !!booking.haSent &&
    !!booking.haReceived &&
    !!booking.lpoNumber &&
    !!booking.lpoValidityDate;

  if (booking.reserved || !gatesComplete) return 'Reserved';
  if (start <= today && today <= end) return 'On Hire';
  return 'Allocated';
}

// Compute total value: dailyRate × days
export function computeTotalValue(dailyRate: number, startDate: string, endDate: string): number {
  if (!startDate || !endDate || !dailyRate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return parseFloat((dailyRate * days).toFixed(2));
}

interface BookingState {
  // User-created bookings (persisted to localStorage)
  userBookings: Booking[];
  addBooking: (booking: Booking) => void;
  updateBooking: (id: string, booking: Partial<Booking>) => void;
  deleteBooking: (id: string) => void;
  // All bookings = mock + user created
  getAllBookings: () => Booking[];
}

export const useBookingStore = create<BookingState>()(
  persist(
    (set, get) => ({
      userBookings: [],

      addBooking: (booking) =>
        set((state) => ({ userBookings: [...state.userBookings, booking] })),

      updateBooking: (id, data) =>
        set((state) => ({
          userBookings: state.userBookings.map((b) =>
            b.id === id ? { ...b, ...data, updatedAt: new Date().toISOString() } : b
          ),
        })),

      deleteBooking: (id) =>
        set((state) => ({
          userBookings: state.userBookings.filter((b) => b.id !== id),
        })),

      getAllBookings: () => {
        const { userBookings } = get();
        return [...mockBookings, ...userBookings];
      },
    }),
    { name: 'fleet-bookings-v1' }
  )
);
