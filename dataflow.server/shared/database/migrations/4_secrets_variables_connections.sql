-- A project's secrets (table from 1_initial.sql), variables and connection profiles.

-- secrets: when it was created, and names unique per project ignoring case (flows read SECRETS['name'])
ALTER TABLE secrets ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX secrets_project_name ON secrets (org_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'), lower(name));

-- variables: plain values the flows read as ENV_VARIABLES['name'] (shown, unlike secrets)
CREATE TABLE variables (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid NOT NULL REFERENCES projects,
  name text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX variables_project_name ON variables (org_id, project_id, lower(name));

-- connection profiles: how to reach a database, an API, a storage or a queue; the config holds the fields of the type
-- (@dataflow/core connection-types) and its sensitive fields name secrets of the project, never a value
CREATE TABLE connections (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid NOT NULL REFERENCES projects,
  name text NOT NULL,
  type text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connections_project_name ON connections (org_id, project_id, lower(name));
