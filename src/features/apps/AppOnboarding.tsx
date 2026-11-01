import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Check, History, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { onboardingService } from '@/services/services';
import { presetsForApp, presetPreview } from '@/constants/appPresets';
import { getApp } from '@/constants/apps';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';

/**
 * App setup screen (Odoo's Choose-your-store pattern), two modes:
 *  - first-time → preset picker ("choose your setup")
 *  - returning  → "Load previous data" vs "Start fresh" (seen on reactivation,
 *                 when the app still has data from before)
 *
 * Backend-ready: all seeding/clearing goes through `onboardingService`.
 */
export function AppOnboarding({
  appId, mode, onDone,
}: {
  appId: string;
  mode: 'first-time' | 'returning';
  onDone: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const markAppOnboarded = useOrgStore((s) => s.markAppOnboarded);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmFresh, setConfirmFresh] = useState(false);

  // After "start fresh" we show the preset picker inline.
  const [showPresets, setShowPresets] = useState(mode === 'first-time');

  const app = getApp(appId);
  const presets = presetsForApp(appId);
  const prevCount = mode === 'returning' ? onboardingService.countAppData(appId) : 0;

  const finish = async () => {
    if (!user) return;
    markAppOnboarded(user.orgId, appId);
    await qc.invalidateQueries();
    onDone();
  };

  const choosePreset = async (presetId: string) => {
    if (!user || busy) return;
    setBusy(presetId);
    try {
      await onboardingService.applyPreset(appId, presetId);
      toastSuccess('Setup complete');
      await finish();
    } catch {
      toastError('Could not apply this setup');
      setBusy(null);
    }
  };

  const loadPrevious = async () => {
    setBusy('load');
    toastSuccess('Loaded your previous data');
    await finish();
  };

  const startFresh = async () => {
    if (!user || busy) return;
    setBusy('fresh');
    try {
      await onboardingService.clearAppData(appId);
      await qc.invalidateQueries();
      // After clearing, drop into the first-time preset picker.
      setBusy(null);
      setConfirmFresh(false);
      // switch this screen to preset mode by faking first-time: re-render as
      // first-time by clearing count → simplest is to show presets now.
      setShowPresets(true);
    } catch {
      toastError('Could not start fresh');
      setBusy(null);
    }
  };

  // ── Returning mode: Load previous vs Start fresh ──
  if (mode === 'returning' && !showPresets) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Welcome back to ${app?.name ?? 'this app'}`}
          description="You have data from before. Keep it, or start over?"
        />
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <button disabled={!!busy} onClick={loadPrevious} className="text-left transition-transform hover:-translate-y-0.5 disabled:opacity-60">
            <Card className="flex h-full flex-col items-center gap-3 p-6 text-center hover:shadow-md">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                {busy === 'load' ? <Loader2 className="h-6 w-6 animate-spin" /> : <History className="h-6 w-6" />}
              </div>
              <div>
                <p className="font-semibold text-foreground">Load previous data</p>
                <p className="mt-1 text-xs text-muted-foreground">Continue with your {prevCount} existing record{prevCount === 1 ? '' : 's'}</p>
              </div>
            </Card>
          </button>

          <button disabled={!!busy} onClick={() => setConfirmFresh(true)} className="text-left transition-transform hover:-translate-y-0.5 disabled:opacity-60">
            <Card className="flex h-full flex-col items-center gap-3 p-6 text-center hover:shadow-md">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                <RefreshCw className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Start fresh</p>
                <p className="mt-1 text-xs text-muted-foreground">Clear existing data and set up again</p>
              </div>
            </Card>
          </button>
        </div>

        {confirmFresh && (
          <div className="mx-auto max-w-2xl rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-rose-800 dark:text-rose-300">
                  This permanently removes your {prevCount} {app?.name} record{prevCount === 1 ? '' : 's'}.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirmFresh(false)} disabled={!!busy}>Cancel</Button>
                  <Button size="sm" onClick={startFresh} disabled={!!busy} className="bg-rose-600 hover:bg-rose-700 text-white">
                    {busy === 'fresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Clear & start fresh'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── First-time (or after "start fresh"): preset picker ──
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Set up ${app?.name ?? 'app'}`}
        description="Choose how you'd like to start. You can change everything later."
      />
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p) => (
          <button key={p.id} disabled={!!busy} onClick={() => choosePreset(p.id)} className="text-left transition-transform hover:-translate-y-0.5 disabled:opacity-60">
            <Card className="flex h-full flex-col items-center gap-3 p-6 text-center hover:shadow-md">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-3xl">
                {busy === p.id ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : p.icon}
              </div>
              <div>
                <p className="font-semibold text-foreground">{p.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
              </div>
              <ul className="mt-1 space-y-0.5">
                {presetPreview(p).map((line) => (
                  <li key={line} className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                    <Check className="h-3 w-3 text-emerald-500" /> {line}
                  </li>
                ))}
              </ul>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
