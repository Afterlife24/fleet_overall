import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Search } from 'lucide-react';
import { getFilteredNavGroups } from '@/app/navigation';
import { useMachines, useBookings, useBreakdowns } from '@/hooks/useQueries';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';

interface SearchItem {
  label: string;
  sublabel: string;
  path: string;
  group: string;
}

export function CommandPalette() {
  const open = useUIStoreOpen();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { data: machines } = useMachines();
  const { data: bookings } = useBookings();
  const { data: breakdowns } = useBreakdowns();

  const user = useAuthStore((s) => s.user);
  const hasPageAccess = useAuthStore((s) => s.hasPageAccess);
  const getActiveApps = useOrgStore((s) => s.getActiveApps);
  const roleCanAccessApp = useOrgStore((s) => s.roleCanAccessApp);
  useOrgStore((s) => s.installedApps);
  useOrgStore((s) => s.roleApps);

  const items: SearchItem[] = useMemo(() => {
    // Navigation results: only apps the company activated AND the role can
    // access (plus always-available Workspace items) — same rule as the sidebar.
    const isAdmin = !!user && (user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager');
    const activeIds = new Set(user ? getActiveApps(user.orgId) : []);
    const isAppActive = (appId: string) =>
      activeIds.has(appId) && (!user || roleCanAccessApp(user.orgId, user.role, appId, user.isOwner));

    const nav: SearchItem[] = getFilteredNavGroups(isAppActive, isAdmin)
      .flatMap((g) => g.items.map((n) => ({ label: n.label, sublabel: g.label, path: n.path, group: 'Navigation' })));

    // Data results — services are already org-scoped, so a company only sees its own.
    const canFleet = isAppActive('fleet');
    const canBreak = isAppActive('breakdowns');
    const canPlan = isAppActive('planner');
    const mc: SearchItem[] = canFleet ? (machines ?? []).slice(0, 20).map((m) => ({ label: m.assetNumber, sublabel: `${m.make} ${m.model} · ${m.status}`, path: `/fleet?id=${m.id}`, group: 'Machines' })) : [];
    const bk: SearchItem[] = canPlan ? (bookings ?? []).slice(0, 10).map((b) => ({ label: b.reference, sublabel: `${b.customerName} · ${b.status}`, path: `/planner`, group: 'Bookings' })) : [];
    const bd: SearchItem[] = canBreak ? (breakdowns ?? []).slice(0, 10).map((b) => ({ label: b.reference, sublabel: `${b.assetNumber} · ${b.severity}`, path: `/breakdowns?id=${b.id}`, group: 'Breakdowns' })) : [];
    return [...nav, ...mc, ...bk, ...bd];
  }, [machines, bookings, breakdowns, user, getActiveApps, roleCanAccessApp, hasPageAccess]);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 12);
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.sublabel.toLowerCase().includes(q)).slice(0, 20);
  }, [items, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchItem[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && useUIStoreClose()}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps and records..."
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[400px] overflow-y-auto p-2">
          {grouped.map(([group, groupItems]) => (
            <div key={group} className="mb-2">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
              {groupItems.map((item) => (
                <button
                  key={`${item.group}-${item.path}-${item.label}`}
                  onClick={() => { navigate(item.path); useUIStoreClose(); }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                >
                  <div className="flex flex-1 flex-col">
                    <span className="font-medium text-foreground">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No results found</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Tiny adapter to avoid importing zustand twice
import { useUIStore } from '@/store/uiStore';
function useUIStoreOpen() {
  return useUIStore((s) => s.commandPaletteOpen);
}
function useUIStoreClose() {
  useUIStore.getState().setCommandPaletteOpen(false);
}
