import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';

/**
 * Decide whether an app page should show its setup screen, and in which mode.
 *
 * Shows whenever the company hasn't "onboarded" this app yet (first activation
 * or a fresh reactivation — deactivating clears the onboarded flag).
 *
 * Mode:
 *  - itemCount === 0 → 'first-time' (preset picker)
 *  - itemCount  > 0  → 'returning'  (Load previous data / Start fresh)
 *
 * `dismiss()` hides it for the current render after the user chooses.
 */
export function useAppOnboarding(appId: string, itemCount: number) {
  const user = useAuthStore((s) => s.user);
  const isAppOnboarded = useOrgStore((s) => s.isAppOnboarded);
  useOrgStore((s) => s.onboardedApps);
  const [dismissed, setDismissed] = useState(false);

  const onboarded = user ? isAppOnboarded(user.orgId, appId) : true;
  const showOnboarding = !onboarded && !dismissed;
  const mode: 'first-time' | 'returning' = itemCount > 0 ? 'returning' : 'first-time';

  return { showOnboarding, mode, dismiss: () => setDismissed(true) };
}
