import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useQueries';
import { timeAgo } from '@/utils/format';
import { getStatusColor } from '@/utils/statusColors';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { Bell, Info, AlertTriangle, CheckCircle2, Wrench, AlertCircle, Check } from 'lucide-react';

const ICONS = {
  info: Info, success: CheckCircle2, warning: AlertTriangle, error: AlertCircle, maintenance: Wrench,
};
const COLORS = {
  info: 'text-sky-500', success: 'text-emerald-500', warning: 'text-amber-500', error: 'text-rose-500', maintenance: 'text-violet-500',
};

type FilterTab = 'All' | 'Unread' | 'Breakdown' | 'Inspection' | 'Workshop' | 'Transport';
const TABS: FilterTab[] = ['All', 'Unread', 'Breakdown', 'Inspection', 'Workshop', 'Transport'];

export function NotificationsPage() {
  const { data: notifs } = useNotifications();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<FilterTab>('All');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!notifs) return [];
    let list = notifs;
    if (activeTab === 'Unread') list = list.filter((n) => !n.read && !readIds.has(n.id));
    else if (activeTab !== 'All') list = list.filter((n) => n.category === activeTab);
    return list;
  }, [notifs, activeTab, readIds]);

  const unreadCount = notifs?.filter((n) => !n.read && !readIds.has(n.id)).length ?? 0;
  const totalCount = notifs?.length ?? 0;

  const markAllRead = () => {
    if (!notifs) return;
    setReadIds(new Set(notifs.filter((n) => !n.read).map((n) => n.id)));
  };

  const isRead = (id: string) => readIds.has(id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread of ${totalCount} total`}
        actions={
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <Check className="mr-1.5 h-4 w-4" /> Mark all as read
          </Button>
        }
      />

      {/* Filter tabs — functional */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Bell className="h-8 w-8" />
              <span className="text-sm">No notifications in this category</span>
            </div>
          ) : (
            filtered.map((n) => {
              const Icon = ICONS[n.type];
              const unread = !n.read && !isRead(n.id);
              return (
                <button
                  key={n.id}
                  onClick={() => { if (n.actionUrl) navigate(n.actionUrl); }}
                  className={cn(
                    'flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/30',
                    unread && 'bg-sky-50/40 dark:bg-sky-950/20'
                  )}
                >
                  <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', COLORS[n.type])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{n.title}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{n.message}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium', getStatusColor(n.category).bg, getStatusColor(n.category).text)}>
                        {n.category}
                      </span>
                      <StatusBadge status={n.priority} size="sm" />
                      {unread && <span className="flex items-center gap-0.5 text-xs text-sky-600 dark:text-sky-400"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" />Unread</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
