-- 0001: extensions, runtime-role scaffolding and migration helper functions.
-- The migration ledger (schema_migrations) is created by the runner, not here.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet_app') THEN
    RAISE EXCEPTION 'Runtime role fleet_app does not exist. Run the database setup first (npm run db:setup:local).';
  END IF;
END
$$;

-- fleet_app may resolve objects in the application schema; table grants are in 0010.
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO fleet_app', current_schema());
END
$$;

-- Adds the composite same-company created_by / updated_by foreign keys to a table.
-- Called after the users table exists; used for the cyclic users references too.
CREATE FUNCTION fleet_add_actor_fks(p_table text, p_with_updated boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id)',
    p_table, 'fk_' || p_table || '_created_by');
  IF p_with_updated THEN
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (org_id, updated_by) REFERENCES users (org_id, id)',
      p_table, 'fk_' || p_table || '_updated_by');
  END IF;
END
$$;

-- Creates a btree index for every foreign key in the current schema that has no index
-- whose leading columns match the key columns (audit-actor keys excluded). Idempotent.
CREATE FUNCTION fleet_create_fk_indexes()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  created integer := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid, c.conname, c.conkey, cl.relname AS tbl,
           (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
     WHERE c.contype = 'f'
       AND cl.relnamespace = current_schema()::regnamespace
       -- Audit-actor columns are never filter or join keys; users are never deleted, only deactivated.
       AND c.conname !~ '_(created|updated)_by$'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = r.conrelid
         AND i.indpred IS NULL
         AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(r.conkey)] = r.conkey
    ) THEN
      EXECUTE format('CREATE INDEX %I ON %I (%s)', left('ix_' || r.conname, 63), r.tbl, r.cols);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END
$$;

REVOKE ALL ON FUNCTION fleet_add_actor_fks(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION fleet_create_fk_indexes() FROM PUBLIC;
