import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { INSTALLABLE_APPS, getApp, type AppDef } from '@/constants/apps';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { Check, Plus, Power, ShieldCheck, LayoutGrid, AlertTriangle } from 'lucide-react';

const CATEGORIES = ['All', 'Operations', 'Inspections', 'Management'] as const;
type Cat = (typeof CATEGORIES)[number];

export function AppsPage() {
  const user = useAuthStore((s) => s.user);
  const activeApps = useOrgStore((s) => (user ? s.getActiveApps(user.orgId) : []));
  // subscribe so cards re-render on toggle
  useOrgStore((s) => s.installedApps);
  const activate = useOrgStore((s) => s.activateApp);
  const deactivate = useOrgStore((s) => s.deactivateApp);
  const [cat, setCat] = useState<Cat>('All');
  const [confirmApp, setConfirmApp] = useState<AppDef | null>(null);

  if (!user) return null;

  const isOwner = user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager';
  const activeSet = new Set(activeApps);

  const apps = useMemo(
    () => INSTALLABLE_APPS.filter((a) => cat === 'All' || a.category === cat),
    [cat]
  );

  const activeCount = INSTALLABLE_APPS.filter((a) => activeSet.has(a.id)).length;

  const onActivate = (app: AppDef) => {
    if (!isOwner) { toastError('Only the owner can manage apps'); return; }
    activate(user.orgId, app.id);
    const deps = (app.depends ?? []).map((d) => getApp(d)?.name).filter(Boolean);
    toastSuccess(deps.length ? `${app.name} activated (also enabled ${deps.join(', ')})` : `${app.name} activated`);
  };

  // Deactivation asks for confirmation first (data is kept, not cleared).
  const requestDeactivate = (app: AppDef) => {
    if (!isOwner) { toastError('Only the owner can manage apps'); return; }
    setConfirmApp(app);
  };

  const confirmDeactivate = () => {
    if (!confirmApp) return;
    const res = deactivate(user.orgId, confirmApp.id);
    if (!res.success) { toastError(res.error || 'Could not deactivate'); setConfirmApp(null); return; }
    toastSuccess(`${confirmApp.name} deactivated`);
    setConfirmApp(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Apps"
        description={`${activeCount} of ${INSTALLABLE_APPS.length} apps active in ${user.orgName}`}
      />

      {!isOwner && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Only the company owner can activate or deactivate apps. You can view what's available.
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                cat === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {apps.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="No apps in this category" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => {
            const active = activeSet.has(app.id);
            const Icon = app.icon;
            const deps = (app.depends ?? []).map((d) => getApp(d)?.name).filter(Boolean) as string[];
            return (
              <Card key={app.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ background: `linear-gradient(135deg, ${app.color ?? '#6366f1'}, ${app.color ?? '#8b5cf6'}cc)` }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{app.name}</h3>
                      {active && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                          <Check className="h-2.5 w-2.5" /> Active
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{app.summary}</p>
                    {deps.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground/70">Requires: {deps.join(', ')}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {active ? (
                    <Button
                      variant="outline" size="sm" disabled={!isOwner}
                      onClick={() => requestDeactivate(app)}
                      className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                    >
                      <Power className="mr-1.5 h-4 w-4" /> Deactivate
                    </Button>
                  ) : (
                    <Button size="sm" disabled={!isOwner} onClick={() => onActivate(app)}>
                      <Plus className="mr-1.5 h-4 w-4" /> Activate
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Deactivate confirmation — data is kept, not cleared */}
      <Dialog open={!!confirmApp} onOpenChange={(o) => !o && setConfirmApp(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Deactivate {confirmApp?.name}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>This hides <span className="font-medium text-foreground">{confirmApp?.name}</span> from the sidebar for everyone in your company.</p>
            <p>Your data is <span className="font-medium text-foreground">kept</span> — if you reactivate later, you can load it back or start fresh.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApp(null)}>Cancel</Button>
            <Button onClick={confirmDeactivate} className="bg-rose-600 hover:bg-rose-700 text-white">Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
