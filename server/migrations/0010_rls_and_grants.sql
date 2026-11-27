-- 0010: row-level security, least-privilege grants for fleet_app and the identity resolver.
-- Runs as the migration role (table owner). fleet_app is not the owner and has no BYPASSRLS.

DO $$
DECLARE
  t record;
  business_tables integer := 0;
  append_only constant text[] := ARRAY['quotation_phase_history', 'gate_movements', 'audit_events'];
  tenant_expr constant text := 'nullif(current_setting(''app.org_id'', true), '''')::uuid';
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
     WHERE c.relnamespace = current_schema()::regnamespace
       AND c.relkind = 'r'
       AND c.relname <> 'schema_migrations'
     ORDER BY c.relname
  LOOP
    business_tables := business_tables + 1;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.relname);

    -- Tenant policy. organizations is the tenant root and is matched on its own id.
    -- nullif(...) turns the empty string left behind on a pooled connection after a transaction-local
    -- set_config into NULL, so "no context" always means "no rows" and never a cast error.
    IF t.relname = 'organizations' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (id = %s) WITH CHECK (id = %s)',
                     t.relname, tenant_expr, tenant_expr);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = %s) WITH CHECK (org_id = %s)',
                     t.relname, tenant_expr, tenant_expr);
    END IF;

    -- Runtime privileges: start from nothing, then grant the minimum.
    EXECUTE format('REVOKE ALL ON %I FROM fleet_app', t.relname);
    IF t.relname = ANY (append_only) THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO fleet_app', t.relname);
    ELSIF t.relname = 'organizations' THEN
      EXECUTE format('GRANT SELECT, UPDATE ON %I TO fleet_app', t.relname);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fleet_app', t.relname);
    END IF;
  END LOOP;

  IF business_tables <> 37 THEN
    RAISE EXCEPTION 'Expected exactly 37 business tables, found %', business_tables;
  END IF;
END
$$;

-- The identity resolver runs as the table owner, which FORCE RLS also subjects to the tenant policy.
-- Read-only policies for the owner role let it look a user up before any Tenant_Context exists.
-- They are bound to the owner role, so fleet_app (a different role) never gains them.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['users', 'roles', 'organizations'] LOOP
    EXECUTE format('CREATE POLICY identity_resolver_read ON %I FOR SELECT TO %I USING (true)', tbl, current_user);
  END LOOP;
END
$$;

CREATE FUNCTION identity_resolver(p_auth_subject text)
RETURNS TABLE (user_id uuid, org_id uuid, role_code text, branch_id uuid, all_branches boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.org_id, r.code, u.branch_id, u.all_branches
    FROM users u
    JOIN roles r ON r.org_id = u.org_id AND r.id = u.role_id
    JOIN organizations o ON o.id = u.org_id
   WHERE u.auth_subject = p_auth_subject
     AND u.status = 'ACTIVE'
     AND o.status = 'ACTIVE'
$$;

REVOKE ALL ON FUNCTION identity_resolver(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity_resolver(text) TO fleet_app;

-- Migration helpers are never callable by the runtime role.
REVOKE ALL ON FUNCTION fleet_valid_gating_rules(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleet_valid_gating_rules(jsonb) TO fleet_app;
