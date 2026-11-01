import { LayoutGrid, Users, Settings } from 'lucide-react';
import { APPS, type AppDef } from '@/constants/apps';

export interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'Operations' | 'Inspections' | 'Documents' | 'Management' | 'Workspace';
  appId: string;
}

// Build the flat list of nav items from the app registry. Each app contributes
// one nav item per page it owns (paths/labels), tagged with its app id so the
// sidebar can show it only when the company has activated that app.
function itemsFromApps(): NavItem[] {
  const items: NavItem[] = [];
  for (const app of APPS) {
    app.paths.forEach((path, i) => {
      items.push({
        label: app.labels[i] ?? app.name,
        path,
        icon: app.icon,
        group: app.category,
        appId: app.id,
      });
    });
  }
  return items;
}

export const navItems: NavItem[] = itemsFromApps();

// Fixed workspace items — always in the sidebar, never activatable.
// Apps (manage modules), Team (members), Roles & Users, Settings.
export const WORKSPACE_ITEMS: NavItem[] = [
  { label: 'Apps', path: '/apps', icon: LayoutGrid, group: 'Workspace', appId: '__workspace__' },
  { label: 'Team', path: '/team', icon: Users, group: 'Workspace', appId: '__workspace__' },
  { label: 'Settings', path: '/settings', icon: Settings, group: 'Workspace', appId: '__workspace__' },
];

const byLabel = (a: NavItem, b: NavItem) => a.label.localeCompare(b.label);
const inGroup = (g: NavItem['group']) => navItems.filter((i) => i.group === g).sort(byLabel);

export const navGroups: { label: string; items: NavItem[] }[] = [
  { label: 'Operations', items: inGroup('Operations') },
  { label: 'Inspections', items: inGroup('Inspections') },
  { label: 'Documents', items: inGroup('Documents') },
  { label: 'Management', items: inGroup('Management') },
  { label: 'Workspace', items: WORKSPACE_ITEMS },
];

/**
 * Filter the sidebar:
 *  - App items show only when the company has ACTIVATED that app AND the user's
 *    role can access the page.
 *  - Workspace items (Apps, Team, Roles & Users, Settings) are always shown,
 *    subject only to role access (Apps is available to everyone).
 */
export function getFilteredNavGroups(
  isAppActive: (appId: string) => boolean,
  isAdmin: boolean,
): { label: string; items: NavItem[] }[] {
  return navGroups
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => {
        // Workspace items (Apps, Team, Settings) are ADMIN-ONLY. Regular
        // employees never see them — they only get the apps assigned to them.
        if (item.appId === '__workspace__') return isAdmin;
        // App visibility is driven solely by: company activated it AND the
        // user's role is allowed it (both folded into isAppActive).
        return isAppActive(item.appId);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function findNavItem(path: string): NavItem | undefined {
  return [...navItems, ...WORKSPACE_ITEMS].find((n) => n.path === path) ||
    navItems.find((n) => path.startsWith(n.path) && n.path !== '/');
}

export function appOf(path: string): AppDef | undefined {
  const item = navItems.find((n) => n.path === path);
  return item ? APPS.find((a) => a.id === item.appId) : undefined;
}
