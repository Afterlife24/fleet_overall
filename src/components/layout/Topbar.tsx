import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Search, Bell, ChevronDown, Check, Building2, Menu, Command, LogOut } from 'lucide-react';
import { useBranchStore, branchOptions as jaBranchOptions } from '@/store/branchStore';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useNotifications, useBranches } from '@/hooks/useQueries';
import { Avatar } from '@/components/common/Avatar';

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { selectedBranchId, selectedBranchName, selectBranch } = useBranchStore();
  const openNotifs = useUIStore((s) => s.openNotificationDrawer);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const { data: notifs } = useNotifications();
  const unread = notifs?.filter((n) => !n.read).length ?? 0;
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { data: orgBranches } = useBranches();
  const isAppActive = useOrgStore((s) => s.isAppActive);

  // The branch filter only appears when the Branches app is active (a single-
  // location company doesn't need it). Johnson Arabia always shows it.
  const isJA = user?.orgId === JA_ORG_ID;
  const showBranchSelector = isJA || (!!user && isAppActive(user.orgId, 'branches'));

  // Johnson Arabia keeps its multi-branch selector (All / UAE / 6 branches).
  // A new company only has its own branches, prefixed with "All Branches".
  const branchOptions = isJA
    ? jaBranchOptions
    : [
        { id: 'all', name: 'All Branches', code: 'ALL', country: '' as const },
        ...(orgBranches ?? []).map((b) => ({ id: b.id, name: b.name, code: b.code, country: b.country })),
      ];

  const [branchOpen, setBranchOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const branchRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) setBranchOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
      <button
        onClick={onMenuClick}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Global Search */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="group flex h-9 max-w-md flex-1 items-center gap-2 rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:border-border"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search apps and records...</span>
        <span className="sm:hidden">Search...</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium sm:flex">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      {/* Branch Selector — only when the Branches app is active */}
      {showBranchSelector && (
      <div ref={branchRef} className="relative hidden sm:block">
        <button
          onClick={() => setBranchOpen((v) => !v)}
          className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[140px] truncate">{selectedBranchName}</span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', branchOpen && 'rotate-180')} />
        </button>
        {branchOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
            {branchOptions.map((b) => (
              <button
                key={b.id}
                onClick={() => { selectBranch(b.id, b.name); setBranchOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent',
                  selectedBranchId === b.id && 'bg-accent'
                )}
              >
                <div className="flex flex-1 flex-col text-left">
                  <span className="font-medium text-foreground">{b.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.id === 'all' ? 'ALL · UAE & KSA'
                      : b.id === 'uae' ? 'UAE · Dubai, AUH, TAW, OIL, FUJ'
                      : `${b.code} · ${b.country || 'UAE'}`}
                  </span>
                </div>
                {selectedBranchId === b.id && <Check className="h-4 w-4 text-sky-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Notifications */}
      <button
        onClick={openNotifs}
        className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>

      {/* Theme toggle - REMOVED, always light mode */}

      {/* Current user with logout */}
      <div ref={userRef} className="relative flex items-center gap-2 border-l border-border pl-3">
        <button onClick={() => setUserOpen((v) => !v)} className="flex items-center gap-2">
          <Avatar name={user?.name ?? 'User'} color={user?.avatarColor ?? '#64748b'} size="sm" />
          <div className="hidden flex-col leading-tight md:flex">
            <span className="text-xs font-semibold text-foreground">{user?.name ?? 'Guest'}</span>
            <span className="text-[11px] text-muted-foreground">{user?.role ?? '—'}</span>
          </div>
          <ChevronDown className={cn('hidden h-4 w-4 text-muted-foreground transition-transform md:block', userOpen && 'rotate-180')} />
        </button>
        {userOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
            <div className="border-b border-border px-2.5 py-2">
              <p className="text-sm font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">{user?.branchName} · {user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
            >
              <LogOut className="h-4 w-4" /> Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
