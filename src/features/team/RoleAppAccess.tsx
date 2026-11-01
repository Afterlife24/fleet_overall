import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthStore, rolePageAccess, type UserRole } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { APPS, getApp } from '@/constants/apps';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { Check, ShieldCheck } from 'lucide-react';

// Roles the owner can configure (exclude the always-everything roles).
const CONFIGURABLE_ROLES = (Object.keys(rolePageAccess) as UserRole[]).filter(
  (r) => r !== 'Managing Director' && r !== 'Executive Manager'
);

/**
 * Owner-only control: for a chosen role, toggle which ACTIVE apps that role may
 * open. Mirrors Odoo's group→menu access. If a role has no explicit config, it
 * can access every active app (least friction); toggling creates an explicit
 * allow-list.
 */
export function RoleAppAccess() {
  const user = useAuthStore((s) => s.user);
  const getActiveApps = useOrgStore((s) => s.getActiveApps);
  const getRoleApps = useOrgStore((s) => s.getRoleApps);
  const setRoleApps = useOrgStore((s) => s.setRoleApps);
  useOrgStore((s) => s.roleApps);

  const [role, setRole] = useState<UserRole>(CONFIGURABLE_ROLES[0]);

  if (!user) return null;

  const activeAppIds = getActiveApps(user.orgId);
  const activeApps = APPS.filter((a) => activeAppIds.includes(a.id));

  // Current allow-list: explicit config, or (default) all active apps.
  const explicit = getRoleApps(user.orgId, role);
  const allowed = new Set(explicit ?? activeAppIds);

  const toggle = (appId: string) => {
    const next = new Set(explicit ?? activeAppIds);
    if (next.has(appId)) next.delete(appId);
    else next.add(appId);
    setRoleApps(user.orgId, role, [...next]);
    toastSuccess(`Updated ${role} access`);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" /> Role → App Access
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose which apps each role can open. Owners and executives always see everything.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Role:</span>
          <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {CONFIGURABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {activeApps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No apps are active yet. Activate apps first on the Apps screen.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {activeApps.map((app) => {
              const on = allowed.has(app.id);
              const Icon = app.icon;
              return (
                <button
                  key={app.id}
                  onClick={() => toggle(app.id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-accent'
                  )}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: app.color ?? '#6366f1' }}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">{app.name}</span>
                  <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30')}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
