import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from './authStore';
import {
  ALL_APP_IDS, DEFAULT_ACTIVE_APP_IDS, withDependencies, getApp,
} from '@/constants/apps';
import { defaultSchema } from '@/constants/appSchemas';
import type { FieldDef } from '@/types/schema';

/**
 * Multi-tenant org layer (Odoo-style, frontend demo).
 *
 * - A company OWNER signs up → creates an Organization + their admin account.
 * - The owner creates MEMBERS inside the app, each with a department/role.
 * - Everyone logs in on the SAME login page; the app resolves their org + role.
 * - Each org's data is isolated by `orgId`.
 *
 * This is a browser-only demo: accounts live in localStorage, passwords are
 * stored in plain text. When a real backend is added, these functions become
 * API calls and the UI stays the same.
 */

export interface OrgAccount {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  email: string;
  password: string;      // demo only — plain text
  role: UserRole;
  branchName: string;
  avatarColor: string;
  isOwner: boolean;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  code: string;          // short shareable code, e.g. "JA-4821"
  ownerEmail: string;
  seeded: boolean;       // true for the built-in Johnson Arabia demo org
  createdAt: string;
}

// The built-in demo org. Johnson Arabia's existing demo accounts belong here.
// It is always present and never editable, so the J.A. demo is untouched.
export const JA_ORG_ID = 'org-ja';

export const johnsonArabiaOrg: Organization = {
  id: JA_ORG_ID,
  name: 'Johnson Arabia LLC',
  code: 'JA-0001',
  ownerEmail: 'md@johnsonarabia.com',
  seeded: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const AVATAR_COLORS = ['#0ea5e9', '#6366f1', '#10b981', '#f97316', '#f59e0b', '#84cc16', '#ec4899', '#14b8a6', '#a855f7', '#06b6d4', '#eab308'];

function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function makeOrgCode(name: string): string {
  const letters = (name.replace(/[^a-zA-Z]/g, '').slice(0, 2) || 'OR').toUpperCase();
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${letters}-${num}`;
}

interface SignupOrgInput {
  companyName: string;
  ownerName: string;
  email: string;
  password: string;
}

interface CreateMemberInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  branchName?: string;
}

interface OrgState {
  organizations: Organization[];
  accounts: OrgAccount[];                // signed-up owners + owner-created members (NOT the J.A. demo list)
  // Per-org activated apps (Odoo-style). Key = orgId, value = active app ids.
  installedApps: Record<string, string[]>;

  signupOrg: (input: SignupOrgInput) => { success: boolean; error?: string; account?: OrgAccount };
  createMember: (orgId: string, input: CreateMemberInput) => { success: boolean; error?: string; account?: OrgAccount };
  updateMember: (id: string, data: Partial<CreateMemberInput>) => { success: boolean; error?: string };
  deleteMember: (id: string) => void;
  findAccount: (email: string, password: string) => OrgAccount | undefined;
  getOrg: (orgId: string) => Organization | undefined;
  membersOf: (orgId: string) => OrgAccount[];

  // ── Apps ──
  getActiveApps: (orgId: string) => string[];
  isAppActive: (orgId: string, appId: string) => boolean;
  activateApp: (orgId: string, appId: string) => void;
  deactivateApp: (orgId: string, appId: string) => { success: boolean; error?: string };

  // ── Role → app access (per org) ──
  // Which apps each role may open. Undefined for a role = all active apps
  // (owner hasn't restricted it yet). Owners/MD always see everything.
  roleApps: Record<string, Record<string, string[]>>; // orgId -> role -> appIds
  getRoleApps: (orgId: string, role: UserRole) => string[] | undefined;
  setRoleApps: (orgId: string, role: UserRole, appIds: string[]) => void;
  roleCanAccessApp: (orgId: string, role: UserRole, appId: string, isOwner: boolean) => boolean;

  // ── App onboarding ("choose your setup") ──
  // Tracks which app a company has already set up, so the preset screen shows
  // only once per app. Key = `${orgId}:${appId}`.
  onboardedApps: Record<string, boolean>;
  isAppOnboarded: (orgId: string, appId: string) => boolean;
  markAppOnboarded: (orgId: string, appId: string) => void;

  // ── Customizable field schemas (mini Studio) ──
  // Per org per app field schema. Key = `${orgId}:${appId}`. Undefined = use
  // the app's default schema.
  appSchemas: Record<string, FieldDef[]>;
  getAppSchema: (orgId: string, appId: string) => FieldDef[];
  setAppSchema: (orgId: string, appId: string, fields: FieldDef[]) => void;
  resetAppSchema: (orgId: string, appId: string) => void;
}

// Johnson Arabia (the demo org) has every app on; a new company gets the
// default set and installs the rest from the Apps screen.
function defaultAppsFor(orgId: string): string[] {
  return orgId === JA_ORG_ID ? [...ALL_APP_IDS] : [...DEFAULT_ACTIVE_APP_IDS];
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set, get) => ({
      organizations: [johnsonArabiaOrg],
      accounts: [],
      installedApps: { [JA_ORG_ID]: [...ALL_APP_IDS] },
      roleApps: {},
      onboardedApps: {},
      appSchemas: {},

      signupOrg: ({ companyName, ownerName, email, password }) => {
        const normEmail = email.trim().toLowerCase();
        if (!companyName.trim() || !ownerName.trim() || !normEmail || !password) {
          return { success: false, error: 'All fields are required' };
        }
        // Email must be unique across demo accounts + signed-up accounts
        if (emailExists(normEmail, get().accounts)) {
          return { success: false, error: 'An account with this email already exists' };
        }

        const orgId = `org-${Date.now()}`;
        const org: Organization = {
          id: orgId,
          name: companyName.trim(),
          code: makeOrgCode(companyName),
          ownerEmail: normEmail,
          seeded: false,
          createdAt: new Date().toISOString(),
        };
        const account: OrgAccount = {
          id: `acc-${Date.now()}`,
          orgId,
          orgName: org.name,
          name: ownerName.trim(),
          email: normEmail,
          password,
          role: 'Managing Director',   // owner = full access
          branchName: 'Head Office',
          avatarColor: pickColor(normEmail),
          isOwner: true,
          createdAt: new Date().toISOString(),
        };

        set((s) => ({
          organizations: [...s.organizations, org],
          accounts: [...s.accounts, account],
          installedApps: { ...s.installedApps, [orgId]: defaultAppsFor(orgId) },
        }));
        return { success: true, account };
      },

      createMember: (orgId, input) => {
        const normEmail = input.email.trim().toLowerCase();
        if (!input.name.trim() || !normEmail || !input.password) {
          return { success: false, error: 'Name, email and password are required' };
        }
        if (emailExists(normEmail, get().accounts)) {
          return { success: false, error: 'An account with this email already exists' };
        }
        const org = get().getOrg(orgId);
        if (!org) return { success: false, error: 'Organization not found' };

        const account: OrgAccount = {
          id: `acc-${Date.now()}`,
          orgId,
          orgName: org.name,
          name: input.name.trim(),
          email: normEmail,
          password: input.password,
          role: input.role,
          branchName: input.branchName?.trim() || 'Head Office',
          avatarColor: pickColor(normEmail),
          isOwner: false,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ accounts: [...s.accounts, account] }));
        return { success: true, account };
      },

      updateMember: (id, data) => {
        const acc = get().accounts.find((a) => a.id === id);
        if (!acc) return { success: false, error: 'Member not found' };
        if (data.email) {
          const normEmail = data.email.trim().toLowerCase();
          if (normEmail !== acc.email && emailExists(normEmail, get().accounts)) {
            return { success: false, error: 'An account with this email already exists' };
          }
        }
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  ...data,
                  email: data.email ? data.email.trim().toLowerCase() : a.email,
                  name: data.name?.trim() ?? a.name,
                }
              : a
          ),
        }));
        return { success: true };
      },

      deleteMember: (id) => {
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id || a.isOwner) }));
      },

      findAccount: (email, password) => {
        const normEmail = email.trim().toLowerCase();
        return get().accounts.find((a) => a.email === normEmail && a.password === password);
      },

      getOrg: (orgId) => get().organizations.find((o) => o.id === orgId),

      membersOf: (orgId) => get().accounts.filter((a) => a.orgId === orgId),

      // ── Apps ──────────────────────────────────────────────────────
      getActiveApps: (orgId) => {
        const stored = get().installedApps[orgId];
        return stored ?? defaultAppsFor(orgId);
      },

      isAppActive: (orgId, appId) => {
        const app = getApp(appId);
        if (app?.core) return true; // core apps are always on
        return get().getActiveApps(orgId).includes(appId);
      },

      activateApp: (orgId, appId) => {
        const current = get().getActiveApps(orgId);
        // activating pulls in dependencies too (Odoo cascade)
        const toAdd = withDependencies(appId).filter((id) => !current.includes(id));
        if (!toAdd.length) return;
        set((s) => ({
          installedApps: { ...s.installedApps, [orgId]: [...current, ...toAdd] },
        }));
      },

      deactivateApp: (orgId, appId) => {
        const app = getApp(appId);
        if (app?.core) return { success: false, error: 'Core apps cannot be deactivated' };
        const current = get().getActiveApps(orgId);
        // No dependency sequence on deactivation — any app can be turned off
        // independently, regardless of what else is active.
        // Clearing the onboarded flag means reactivating later re-shows the
        // setup choice ("load previous data" vs "start fresh").
        set((s) => {
          const nextOnboarded = { ...s.onboardedApps };
          delete nextOnboarded[`${orgId}:${appId}`];
          return {
            installedApps: { ...s.installedApps, [orgId]: current.filter((id) => id !== appId) },
            onboardedApps: nextOnboarded,
          };
        });
        return { success: true };
      },

      // ── Role → app access ─────────────────────────────────────────
      getRoleApps: (orgId, role) => get().roleApps[orgId]?.[role],

      setRoleApps: (orgId, role, appIds) => {
        set((s) => ({
          roleApps: {
            ...s.roleApps,
            [orgId]: { ...(s.roleApps[orgId] ?? {}), [role]: appIds },
          },
        }));
      },

      roleCanAccessApp: (orgId, role, appId, isOwner) => {
        // Owners and top management always see everything that's active.
        if (isOwner || role === 'Managing Director' || role === 'Executive Manager') return true;
        const allowed = get().roleApps[orgId]?.[role];
        if (allowed) return allowed.includes(appId);
        // No explicit assignment:
        //  - Johnson Arabia demo (JA_ORG_ID): keep permissive (all active apps)
        //    so the demo accounts still show their pages.
        //  - A signed-up company: strict — the employee sees nothing until the
        //    owner assigns apps to their role on the Team page.
        return orgId === JA_ORG_ID;
      },

      // ── App onboarding ────────────────────────────────────────────
      isAppOnboarded: (orgId, appId) => {
        // Johnson Arabia already has data everywhere — never show onboarding.
        if (orgId === JA_ORG_ID) return true;
        return !!get().onboardedApps[`${orgId}:${appId}`];
      },
      markAppOnboarded: (orgId, appId) => {
        set((s) => ({ onboardedApps: { ...s.onboardedApps, [`${orgId}:${appId}`]: true } }));
      },

      // ── Customizable schemas ──────────────────────────────────────
      getAppSchema: (orgId, appId) => {
        const custom = get().appSchemas[`${orgId}:${appId}`];
        return custom ?? defaultSchema(appId);
      },
      setAppSchema: (orgId, appId, fields) => {
        set((s) => ({ appSchemas: { ...s.appSchemas, [`${orgId}:${appId}`]: fields } }));
      },
      resetAppSchema: (orgId, appId) => {
        set((s) => {
          const next = { ...s.appSchemas };
          delete next[`${orgId}:${appId}`];
          return { appSchemas: next };
        });
      },
    }),
    { name: 'fleet-orgs-v2' }
  )
);

// Email is taken if it collides with a signed-up account or a built-in J.A. demo account.
function emailExists(normEmail: string, accounts: OrgAccount[]): boolean {
  if (accounts.some((a) => a.email === normEmail)) return true;
  // Avoid collisions with the hardcoded J.A. demo accounts
  return JA_DEMO_EMAILS.has(normEmail);
}

// Kept in sync with demoAccounts in authStore — the built-in J.A. demo logins.
const JA_DEMO_EMAILS = new Set<string>([
  'md@johnsonarabia.com',
  'exec@johnsonarabia.com',
  'opsmgr@johnsonarabia.com',
  'hiredesk@johnsonarabia.com',
  'wsmanager@johnsonarabia.com',
  'wscoord@johnsonarabia.com',
  'procurement@johnsonarabia.com',
  'gate@johnsonarabia.com',
  'checker@johnsonarabia.com',
  'sales@johnsonarabia.com',
  'driver@johnsonarabia.com',
  'finance@johnsonarabia.com',
]);
