import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { NotificationDrawer } from './NotificationDrawer';
import { CommandPalette } from './CommandPalette';
import { Breadcrumbs } from './Breadcrumbs';
import { useUIStore } from '@/store/uiStore';
import { DevFixtureBadge } from '@/components/common/ApiStatus';
import { useApiSession } from '@/services/api/session';
import { useRetainedMirrorSync } from '@/hooks/useApiResources';
import { useInvoiceMirrorSync } from '@/hooks/api/useInvoicesApi';
import { Sheet, SheetContent } from '@/components/ui/sheet';

export function AppLayout() {
  // Starts the API session (development fixture identity in dev builds) and keeps the retained screens' read copies fresh.
  useApiSession();
  useRetainedMirrorSync();
  useInvoiceMirrorSync();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const closeMobileSidebar = () => setMobileSidebarOpen(false);
  const openMobileSidebar = () => setMobileSidebarOpen(true);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile Sidebar Drawer */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <Sidebar onNavigate={closeMobileSidebar} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={openMobileSidebar} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Breadcrumbs />
              <DevFixtureBadge />
            </div>
            <Outlet />
          </div>
        </main>
      </div>
      <NotificationDrawer />
      <CommandPalette />
    </div>
  );
}
