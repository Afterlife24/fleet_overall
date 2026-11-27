import { describe, expect, it } from 'vitest';
import {
  ACTION_CODES, authorize, defaultActionsForRole, effectiveActions, roleCodeFromName, type Principal,
} from '../../src/auth/principal.js';

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1', displayName: 'U', orgId: 'org-a', orgName: 'A', roleCode: 'sales-executive',
  branchId: 'br-1', allBranches: false, permissions: ['customers.read'], authMode: 'oidc', ...over,
});

describe('role allowlist', () => {
  it('slugs frontend role names', () => {
    expect(roleCodeFromName('PHI/PDI Checker')).toBe('phi-pdi-checker');
    expect(roleCodeFromName('Managing Director')).toBe('managing-director');
  });

  it('grants the reopen permission to managers but not to Sales Executive', () => {
    expect(defaultActionsForRole('sales-manager')).toContain('quotations.reopen');
    expect(defaultActionsForRole('managing-director')).toEqual([...ACTION_CODES]);
    expect(defaultActionsForRole('sales-executive')).not.toContain('quotations.reopen');
    // Security records gate movements but has no CRM, invoice or approval rights.
    const security = defaultActionsForRole('security');
    expect(security).toEqual(expect.arrayContaining(['company.read', 'gate.read', 'gate.write']));
    for (const denied of ['quotations.write', 'invoices.read', 'gate.approve', 'inspections.release_hold', 'bookings.write']) {
      expect(security).not.toContain(denied);
    }
    expect(defaultActionsForRole('custom-role')).toEqual([]);
  });

  it('restricts stored permissions to the allowlist and falls back to defaults when none are stored', () => {
    expect(effectiveActions('custom-role', ['customers.read', 'made.up'])).toEqual(['customers.read']);
    expect(effectiveActions('security', [])).toEqual(defaultActionsForRole('security'));
    expect(effectiveActions('security', ['company.read'])).toEqual(['company.read']);
    expect(effectiveActions('custom-role', ['made.up'])).toEqual([]);
  });
});

describe('authorize', () => {
  it('allows a granted action on an own-company, own-branch resource', () => {
    expect(authorize(principal(), 'customers.read', { orgId: 'org-a', branchId: 'br-1' })).toBe('allow');
  });
  it('forbids a missing permission and an unknown action', () => {
    expect(authorize(principal(), 'customers.write', { orgId: 'org-a' })).toBe('forbid');
    expect(authorize(principal(), 'made.up')).toBe('forbid');
  });
  it('hides another company resource and forbids another branch', () => {
    expect(authorize(principal(), 'customers.read', { orgId: 'org-b' })).toBe('hide');
    expect(authorize(principal(), 'customers.read', { orgId: 'org-a', branchId: 'br-2' })).toBe('forbid');
    expect(authorize(principal({ allBranches: true }), 'customers.read', { orgId: 'org-a', branchId: 'br-2' })).toBe('allow');
  });
});
