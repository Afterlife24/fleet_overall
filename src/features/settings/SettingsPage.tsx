import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { Building2, Bell, Copy } from 'lucide-react';

// Genuine workspace preferences — company profile + notifications.
// Domain configuration lives where it belongs now:
//   • Branches  → the Branches app
//   • Roles & app access → the Team page
//   • Machine categories / types / status codes → the Fleet app
const NOTIF_SETTINGS = [
  { label: 'Breakdown alerts', desc: 'Get notified when a machine breaks down', defaultEnabled: true, category: 'Breakdown' },
  { label: 'Inspection reminders', desc: 'Reminders for upcoming and overdue inspections', defaultEnabled: true, category: 'Inspection' },
  { label: 'Booking confirmations', desc: 'Notifications for new and approved bookings', defaultEnabled: true, category: 'Booking' },
  { label: 'Workshop updates', desc: 'Job status changes and parts delays', defaultEnabled: false, category: 'Workshop' },
  { label: 'Transport dispatch', desc: 'Driver assignments and delivery updates', defaultEnabled: true, category: 'Transport' },
  { label: 'Daily digest email', desc: 'Summary of fleet status every morning', defaultEnabled: false, category: 'System' },
  { label: 'Weekly report email', desc: 'Performance report delivered every Monday', defaultEnabled: true, category: 'System' },
];

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const getOrg = useOrgStore((s) => s.getOrg);
  const org = user ? getOrg(user.orgId) : undefined;
  const isOwner = !!user && (user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager');

  const [companyName, setCompanyName] = useState(org?.name ?? user?.orgName ?? '');
  const [notifStates, setNotifStates] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_SETTINGS.map((s) => [s.label, s.defaultEnabled]))
  );

  const copyCode = () => {
    if (org?.code) {
      navigator.clipboard?.writeText(org.code);
      toastSuccess(`Company code ${org.code} copied`);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Company profile and notification preferences" />

      {/* Company profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" /> Company Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Company name</label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!isOwner} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Company code</label>
              <div className="flex items-center gap-2">
                <Input value={org?.code ?? '—'} readOnly className="font-mono" />
                <Button type="button" variant="outline" size="sm" onClick={copyCode}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
          {isOwner && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => toastSuccess('Company profile saved')}>Save changes</Button>
            </div>
          )}
          {!isOwner && (
            <p className="text-xs text-muted-foreground">Only the company owner can edit the profile.</p>
          )}
        </CardContent>
      </Card>

      {/* Notification preferences */}
      <Card className="p-0">
        <CardHeader className="pb-0 pt-5 px-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-primary" /> Notification Preferences
          </CardTitle>
        </CardHeader>
        <div className="mt-2 divide-y divide-border">
          {NOTIF_SETTINGS.map((setting) => {
            const enabled = notifStates[setting.label] ?? setting.defaultEnabled;
            return (
              <div key={setting.label} className="flex items-center justify-between px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{setting.label}</p>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{setting.category}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{setting.desc}</p>
                </div>
                <button
                  onClick={() => setNotifStates((prev) => ({ ...prev, [setting.label]: !enabled }))}
                  className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', enabled ? 'bg-primary' : 'bg-muted')}
                >
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', enabled ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Branches are managed in the <span className="font-medium text-foreground">Branches</span> app · roles and member access in <span className="font-medium text-foreground">Team</span> · machine categories and status codes in the <span className="font-medium text-foreground">Fleet</span> app.
      </p>
    </div>
  );
}
