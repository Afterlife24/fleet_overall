import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navGroups, getFilteredNavGroups } from '@/app/navigation';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { ChevronLeft } from 'lucide-react';
import { useNotifications } from '@/hooks/useQueries';
import { BrandLogo } from '@/components/common/BrandLogo';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const hasPageAccess = useAuthStore((s) => s.hasPageAccess);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const orgLabel = user?.orgName ?? 'Johnson Arabia';
  const getActiveApps = useOrgStore((s) => s.getActiveApps);
  const roleCanAccessApp = useOrgStore((s) => s.roleCanAccessApp);
  useOrgStore((s) => s.installedApps); // re-render when apps change
  useOrgStore((s) => s.roleApps);      // re-render when role access changes
  const activeAppIds = new Set(user ? getActiveApps(user.orgId) : []);
  // Owner / MD / Executive are admins: they see every app + workspace items.
  const isAdmin = !!user && (user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager');
  // An app shows if the company activated it AND the user's role may access it.
  const isAppActive = (appId: string) =>
    activeAppIds.has(appId) &&
    (!user || roleCanAccessApp(user.orgId, user.role, appId, user.isOwner));
  const { data: notifs } = useNotifications();
  const unread = notifs?.filter((n) => !n.read).length ?? 0;

  // Filter navigation by activated apps + role→app access + admin
  const filteredGroups = getFilteredNavGroups(isAppActive, isAdmin);

  return (
    <aside
      className={cn(
        'relative z-30 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-64'
      )}
    >
      {/* Logo — AxleOps brand with the current company as subtitle */}
      <div className={cn('flex h-16 items-center border-b border-border px-4', collapsed && 'justify-center px-0')}>
        <BrandLogo size="sm" showText={!collapsed} subtitle={orgLabel} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
        {filteredGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5 px-2">
              {group.items.map((item) => {
                const isActive =
                  item.path === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.path);
                const showBadge = item.label === 'Notifications' && unread > 0;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                    )}
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {showBadge && (
                      <span
                        className={cn(
                          'ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white',
                          collapsed && 'absolute -right-0 -top-0'
                        )}
                      >
                        {unread}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className={cn(
          'flex h-12 items-center gap-2 border-t border-border px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          collapsed && 'justify-center px-0'
        )}
      >
        <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
