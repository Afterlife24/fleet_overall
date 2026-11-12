import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { Building2, Bell, Copy } from 'lucide-react';

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
  const updateOrgProfile = useOrgStore((s) => s.updateOrgProfile);
  const org = user ? getOrg(user.orgId) : undefined;
  const isOwner = !!user && (user.isOwner || user.role === 'Managing Director' || user.role === 'Executive Manager');

  const [companyName, setCompanyName] = useState(org?.name ?? user?.orgName ?? '');
  const [tradeLicense, setTradeLicense] = useState(org?.tradeLicense ?? '');
  const [companyTrn, setCompanyTrn] = useState(org?.companyTrn ?? '');
  const [companyAddress, setCompanyAddress] = useState(org?.companyAddress ?? '');
  const [companyPhone, setCompanyPhone] = useState(org?.companyPhone ?? '');
  const [companyEmail, setCompanyEmail] = useState(org?.companyEmail ?? '');

  const [notifStates, setNotifStates] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_SETTINGS.map((s) => [s.label, s.defaultEnabled]))
  );

  const copyCode = () => {
    if (org?.code) {
      navigator.clipboard?.writeText(org.code);
      toastSuccess(`Company code ${org.code} copied`);
    }
  };

  const saveProfile = () => {
    if (!user) return;
    updateOrgProfile(user.orgId, {
      name: companyName,
      tradeLicense,
      companyTrn,
      companyAddress,
      companyPhone,
      companyEmail,
    });
    toastSuccess('Company profile saved');
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Company profile and notification preferences" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" /> Company Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

            <div className="space-y-1.5">
              <Label>Company name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!isOwner} />
            </div>

            <div className="space-y-1.5">
              <Label>Company code</Label>
              <div className="flex items-center gap-2">
                <Input value={org?.code ?? '—'} readOnly className="font-mono" />
                <Button type="button" variant="outline" size="sm" onClick={copyCode}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Trade License No.</Label>
              <Input value={tradeLicense} onChange={(e) => setTradeLicense(e.target.value)} disabled={!isOwner} placeholder="e.g. JA-TL-2024-001" />
            </div>

            <div className="space-y-1.5">
              <Label>VAT Registration No. (TRN)</Label>
              <Input value={companyTrn} onChange={(e) => setCompanyTrn(e.target.value)} disabled={!isOwner} placeholder="e.g. 100234567800003" />
            </div>

            <div className="space-y-1.5">
              <Label>Company Phone</Label>
              <Input value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} disabled={!isOwner} placeholder="+971 4 123 4567" />
            </div>

            <div className="space-y-1.5">
              <Label>Company Email</Label>
              <Input type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} disabled={!isOwner} placeholder="info@company.com" />
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label>Company Address</Label>
              <Input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} disabled={!isOwner} placeholder="e.g. Office 1204, Business Centre, Dubai, UAE" />
            </div>
          </div>

          {isOwner ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={saveProfile}>Save changes</Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only the company owner can edit the profile.</p>
          )}
        </CardContent>
      </Card>

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
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform',
                      enabled ? 'translate-x-4' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
