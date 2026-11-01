import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarCollapsed: boolean;
  notificationDrawerOpen: boolean;
  commandPaletteOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  openNotificationDrawer: () => void;
  closeNotificationDrawer: () => void;
  setCommandPaletteOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      notificationDrawerOpen: false,
      commandPaletteOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      openNotificationDrawer: () => set({ notificationDrawerOpen: true }),
      closeNotificationDrawer: () => set({ notificationDrawerOpen: false }),
      setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
    }),
    { name: 'fleet-ui' }
  )
);
