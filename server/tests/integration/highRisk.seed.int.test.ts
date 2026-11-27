// High-risk area 6: re-running the dev seed refreshes role permissions (new codes) and creates no duplicates.
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultActionsForRole } from '../../src/auth/principal.js';
import { countSeedRows, runSeed } from '../../scripts/seedDevLib.js';
import { inTenant, migrateTestDb, migratorUrl, resetPublicSchema } from './testDb.js';

const DEV_USER_ID = '5d1b7c52-3f0e-4a8a-9d52-0c6f2b8a9e11';
const seed = () => runSeed({ url: migratorUrl(), devUserId: DEV_USER_ID, nodeEnv: 'test' });

interface RoleRow { code: string; permissions: string[] }
const roles = (orgId: string) =>
  inTenant(migratorUrl(), orgId, async (c) => (await c.query<RoleRow>('SELECT code, permissions FROM roles ORDER BY code')).rows);

describe('seed:dev role permissions and duplicates', () => {
  beforeAll(async () => {
    await resetPublicSchema();
    await migrateTestDb();
  });

  it('second run gives the Managing Director every current default permission (gate.approve) and no duplicate rows', async () => {
    const first = await seed();
    // Simulate a database seeded before the gate/inspection codes existed.
    await inTenant(migratorUrl(), first.orgId, async (c) => {
      await c.query(
        `UPDATE roles SET permissions = ARRAY(SELECT p FROM unnest(permissions) p WHERE p NOT LIKE 'gate.%' AND p NOT LIKE 'inspections.%')`,
      );
    });
    const stale = await roles(first.orgId);
    expect(stale.find((r) => r.code === 'managing-director')?.permissions).not.toContain('gate.approve');

    const second = await seed();
    expect(second.orgId).toBe(first.orgId);
    expect(second.counts).toEqual(first.counts);
    const after = await roles(first.orgId);
    const md = after.find((r) => r.code === 'managing-director');
    expect(md?.permissions).toContain('gate.approve');
    for (const r of after) {
      expect(new Set(r.permissions), `role ${r.code}`).toEqual(new Set(defaultActionsForRole(r.code)));
    }
    expect(new Set(after.map((r) => r.code)).size).toBe(after.length);

    const third = await seed();
    expect(third.counts).toEqual(first.counts);
    expect(await roles(first.orgId)).toEqual(after);
    await inTenant(migratorUrl(), first.orgId, async (c) => {
      expect(await countSeedRows(c, first.orgId)).toEqual(first.counts);
      const dupUsers = await c.query("SELECT normalized_email FROM users GROUP BY 1 HAVING count(*) > 1");
      expect(dupUsers.rowCount).toBe(0);
      const dupApps = await c.query('SELECT app_code FROM organization_apps GROUP BY 1 HAVING count(*) > 1');
      expect(dupApps.rowCount).toBe(0);
    });
  });
});
