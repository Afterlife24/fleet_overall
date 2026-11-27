import { authorize, type ActionCode, type Principal } from '../../auth/principal.js';
import type { TxClient } from '../../db/tx.js';
import { AppError } from '../../errors.js';
import type { CustomFieldDef, CustomFieldType } from './customAttributes.js';

/**
 * SQL condition limiting rows to the Principal's branch scope, or undefined when the Principal sees all branches.
 * `allowNull` also admits rows with no branch (customers may have none). The value is parameterized.
 */
export function branchScopeClause(
  principal: Principal,
  column: string,
  params: unknown[],
  allowNull: boolean,
): string | undefined {
  if (principal.allBranches) return undefined;
  const orNull = allowNull ? ` OR ${column} IS NULL` : '';
  if (!principal.branchId) return allowNull ? `${column} IS NULL` : 'false';
  params.push(principal.branchId);
  return `(${column} = $${params.length}${orNull})`;
}

/** A record outside the Principal's branch scope does not exist for them: 404. */
export function assertInScope(principal: Principal, action: ActionCode, branchId: string | null): void {
  if (authorize(principal, action, { orgId: principal.orgId, branchId }) !== 'allow') {
    throw new AppError('NOT_FOUND', 'Record not found');
  }
}

/** Writing into a branch outside the Principal's scope is forbidden (403). */
export function assertWritableBranch(principal: Principal, action: ActionCode, branchId: string | null): void {
  if (authorize(principal, action, { orgId: principal.orgId, branchId }) !== 'allow') {
    throw new AppError('FORBIDDEN', 'You do not have access to this branch', { branchId: 'out_of_scope' });
  }
}

/** The branch must exist (in the Principal's organization, via RLS) and be active. */
export async function assertActiveBranch(tx: TxClient, branchId: string | null | undefined): Promise<void> {
  if (!branchId) return;
  const res = await tx.query<{ active: boolean }>('SELECT active FROM branches WHERE id = $1', [branchId]);
  if (!res.rows[0] || !res.rows[0].active) {
    throw new AppError('VALIDATION_ERROR', 'Branch not found', { branchId: 'not_found' });
  }
}

/** Active custom field definitions of an entity type, as validator input. */
export async function loadFieldDefs(tx: TxClient, entityType: string): Promise<CustomFieldDef[]> {
  const res = await tx.query<{ field_key: string; field_type: CustomFieldType; required: boolean; options: string[] }>(
    `SELECT field_key, field_type, required, options FROM custom_field_definitions
      WHERE entity_type = $1 AND active ORDER BY display_order, field_key, id`,
    [entityType],
  );
  const seen = new Set<string>();
  const defs: CustomFieldDef[] = [];
  for (const r of res.rows) {
    if (seen.has(r.field_key)) continue;
    seen.add(r.field_key);
    defs.push({ fieldKey: r.field_key, fieldType: r.field_type, required: r.required, options: r.options ?? [] });
  }
  return defs;
}
