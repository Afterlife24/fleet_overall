-- 0002: organizations, branches, roles, users, organization_apps, custom_field_definitions.
-- DATABASE_DESIGN.md sections 2 and 3.1. Every table except organizations has (org_id, id) unique
-- so that children can reference parents with composite same-company foreign keys.

-- The gating rules document holds exactly the seven existing booleans.
CREATE FUNCTION fleet_valid_gating_rules(g jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(g) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(g)) = 7
     AND g ?& ARRAY['requireQuote','requireHaSent','requireHaReceived','requireLpo',
                    'blockCreditHold','requireTpcValid','warnOverdueInspection']
     AND jsonb_typeof(g -> 'requireQuote') = 'boolean'
     AND jsonb_typeof(g -> 'requireHaSent') = 'boolean'
     AND jsonb_typeof(g -> 'requireHaReceived') = 'boolean'
     AND jsonb_typeof(g -> 'requireLpo') = 'boolean'
     AND jsonb_typeof(g -> 'blockCreditHold') = 'boolean'
     AND jsonb_typeof(g -> 'requireTpcValid') = 'boolean'
     AND jsonb_typeof(g -> 'warnOverdueInspection') = 'boolean'
$$;

CREATE TABLE organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  trade_license       text,
  tax_registration_no text,
  address             text NOT NULL,
  phone               text,
  email               text,
  timezone            text NOT NULL,
  currency_code       char(3) NOT NULL,
  vat_rate            numeric(9,6) NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE',
  gating_rules        jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  row_version         bigint NOT NULL DEFAULT 1,
  CONSTRAINT ck_organizations_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_organizations_vat_rate CHECK (vat_rate >= 0 AND vat_rate <= 1),
  CONSTRAINT ck_organizations_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_organizations_gating_rules CHECK (fleet_valid_gating_rules(gating_rules)),
  CONSTRAINT ck_organizations_row_version CHECK (row_version >= 1)
);

CREATE TABLE branches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  country_code    char(2) NOT NULL,
  city            text NOT NULL,
  address         text NOT NULL,
  phone           text,
  manager_user_id uuid,
  timezone        text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  row_version     bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_branches_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_branches_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_branches_code UNIQUE (org_id, code),
  CONSTRAINT ck_branches_country CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT ck_branches_row_version CHECK (row_version >= 1)
);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  permissions text[] NOT NULL,
  app_codes   text[] NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_roles_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_roles_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_roles_code UNIQUE (org_id, code),
  CONSTRAINT ck_roles_row_version CHECK (row_version >= 1)
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  role_id          uuid NOT NULL,
  branch_id        uuid,
  normalized_email text NOT NULL,
  display_name     text NOT NULL,
  phone            text,
  auth_provider    text NOT NULL,
  auth_subject     text NOT NULL,
  is_owner         boolean NOT NULL DEFAULT false,
  all_branches     boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'ACTIVE',
  avatar_color     text,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  row_version      bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_users_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_users_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_users_normalized_email UNIQUE (normalized_email),
  CONSTRAINT uq_users_auth_subject UNIQUE (auth_subject),
  CONSTRAINT fk_users_role FOREIGN KEY (org_id, role_id) REFERENCES roles (org_id, id),
  CONSTRAINT fk_users_branch FOREIGN KEY (org_id, branch_id) REFERENCES branches (org_id, id),
  CONSTRAINT ck_users_email_normalized CHECK (normalized_email = lower(btrim(normalized_email)) AND normalized_email <> ''),
  CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  CONSTRAINT ck_users_row_version CHECK (row_version >= 1)
);

-- Cyclic references to users, added now that users exists.
ALTER TABLE branches ADD CONSTRAINT fk_branches_manager FOREIGN KEY (org_id, manager_user_id) REFERENCES users (org_id, id);
SELECT fleet_add_actor_fks('branches');
SELECT fleet_add_actor_fks('roles');
SELECT fleet_add_actor_fks('users');

CREATE TABLE organization_apps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  app_code    text NOT NULL,
  active      boolean NOT NULL DEFAULT false,
  onboarded   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_organization_apps_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_organization_apps_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_organization_apps_code UNIQUE (org_id, app_code),
  CONSTRAINT ck_organization_apps_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('organization_apps');

CREATE TABLE custom_field_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  app_code      text NOT NULL,
  entity_type   text NOT NULL,
  field_key     text NOT NULL,
  label         text NOT NULL,
  field_type    text NOT NULL,
  required      boolean NOT NULL DEFAULT false,
  options       jsonb NOT NULL DEFAULT '[]',
  display_order integer NOT NULL DEFAULT 0,
  system_field  boolean NOT NULL DEFAULT false,
  in_table      boolean NOT NULL DEFAULT true,
  filterable    boolean NOT NULL DEFAULT false,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  row_version   bigint NOT NULL DEFAULT 1,
  CONSTRAINT fk_custom_field_definitions_org FOREIGN KEY (org_id) REFERENCES organizations (id),
  CONSTRAINT uq_custom_field_definitions_org_id UNIQUE (org_id, id),
  CONSTRAINT uq_custom_field_definitions_key UNIQUE (org_id, app_code, entity_type, field_key),
  CONSTRAINT ck_custom_field_definitions_type CHECK (field_type IN ('TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'BOOLEAN')),
  CONSTRAINT ck_custom_field_definitions_options CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT ck_custom_field_definitions_row_version CHECK (row_version >= 1)
);
SELECT fleet_add_actor_fks('custom_field_definitions');

CREATE INDEX ix_users_org_status ON users (org_id, status);
CREATE INDEX ix_branches_org_active ON branches (org_id, active);

SELECT fleet_create_fk_indexes();
