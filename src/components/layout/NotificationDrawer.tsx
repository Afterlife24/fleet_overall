import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUIStore } from '@/store/uiStore';
import { useNotifications } from '@/hooks/useQueries';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/utils/format';
import { getStatusColor } from '@/utils/statusColors';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Info, CheckCircle2, Wrench, AlertCircle } from 'lucide-react';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  maintenance: Wrench,
};

const COLORS = {
  info: 'text-sky-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-rose-500',
  maintenance: 'text-violet-500',
};

export function NotificationDrawer() {
  const open = useUIStore((s) => s.notificationDrawerOpen);
  const close = useUIStore((s) => s.closeNotificationDrawer);
  const { data: notifs, isLoading } = useNotifications();
  const navigate = useNavigate();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && close()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {notifs?.filter((n) => !n.read).length ?? 0} unread of {notifs?.length ?? 0} total
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading...</p>}
          {notifs?.map((n) => {
            const Icon = ICONS[n.type];
            return (
              <button
                key={n.id}
                onClick={() => { if (n.actionUrl) { navigate(n.actionUrl); close(); } }}
                className={cn(
                  'flex w-full gap-3 border-b border-border px-5 py-4 text-left transition-colors hover:bg-muted/40',
                  !n.read && 'bg-sky-50/40 dark:bg-sky-950/20'
                )}
              >
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', COLORS[n.type])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{n.message}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                      getStatusColor(n.category).bg, getStatusColor(n.category).text
                    )}>
                      {n.category}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
