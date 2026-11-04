-- Initial schema

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- the people of an organization (no credentials yet: there is no login)
CREATE TABLE users (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON users (lower(email));

CREATE TABLE organization_settings (
  org_id uuid NOT NULL REFERENCES organizations,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,         -- soft delete: rows are never DELETEd (their flows and history keep pointing here)
  deleted_by text,
  -- how it shows in the editor's lists: an icon and its color, by name (the editor owns the list of names)
  icon text NOT NULL DEFAULT 'folder',
  color text NOT NULL DEFAULT 'blue'
);
CREATE INDEX projects_org ON projects (org_id) WHERE deleted_at IS NULL;

-- folders: only a visual organization of a project's flows, nested to any depth. A flow's folder and name live on the
-- flows row, never in flow_versions: moving or renaming a flow keeps its id and needs no deploy.
CREATE TABLE folders (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid NOT NULL REFERENCES projects,
  parent_id uuid REFERENCES folders,  -- null = at the project's root
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,             -- soft delete; archiving a folder archives what is under it with the same time
  deleted_by text
);
CREATE INDEX folders_project ON folders (org_id, project_id);
-- names are unique among live siblings, ignoring case (the root is the all-zero uuid here)
CREATE UNIQUE INDEX folders_live_name ON folders (project_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'), lower(name))
  WHERE deleted_at IS NULL;

CREATE TABLE flows (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid NOT NULL REFERENCES projects,
  name text NOT NULL,
  draft_definition jsonb, -- the editor's current draft of the flow; null where readonly = true
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,         -- soft delete: versions and deployment history must keep pointing here
  deleted_by text,
  folder_id uuid REFERENCES folders,  -- null = at the project's root
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flows_project ON flows (org_id, project_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX flows_live_name ON flows (project_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'), lower(name))
  WHERE deleted_at IS NULL;

-- immutable: never UPDATE; id and number arrive unchanged from the source instance in a promotion
CREATE TABLE flow_versions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  flow_id uuid NOT NULL REFERENCES flows,
  number int NOT NULL,
  definition jsonb NOT NULL, -- the immutable definition of the flow at this version
  content_hash text NOT NULL,
  received_from text,             -- null = created here by a deploy; otherwise the source environment
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, number)
);

CREATE TABLE deployments (
  org_id uuid NOT NULL REFERENCES organizations,
  flow_id uuid PRIMARY KEY REFERENCES flows,
  flow_version_id uuid NOT NULL REFERENCES flow_versions,
  deployed_by text,
  deployed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deployment_history (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  flow_id uuid NOT NULL REFERENCES flows,
  from_version_id uuid REFERENCES flow_versions,          -- what deployments pointed to before (null on the first deploy)
  to_version_id uuid NOT NULL REFERENCES flow_versions,   -- what it points to now
  action text NOT NULL CHECK (action IN ('deploy', 'promote', 'rollback')),
  source_env text,
  by_user text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deployment_history_flow ON deployment_history (org_id, flow_id, at DESC);

-- packages sent to and received from other instances
CREATE TABLE promotions (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  direction text NOT NULL CHECK (direction IN ('sent', 'received')),
  peer_env text NOT NULL,
  package jsonb NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
  requested_by text,
  approved_by text,
  at timestamptz NOT NULL DEFAULT now()
);

-- a project's secrets: values per instance (the same name has one value in DEV and another in PROD); flows read
-- SECRETS['name'], names unique per project ignoring case
CREATE TABLE secrets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid REFERENCES projects,
  name text NOT NULL,
  key_version text NOT NULL,      -- which key of the keyring encrypted it
  nonce bytea NOT NULL,           -- 12 random bytes, new on every write
  ciphertext bytea NOT NULL,      -- AES-256-GCM (tag included); AAD = id + name
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, name)
);
CREATE UNIQUE INDEX secrets_project_name ON secrets (org_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'), lower(name));

-- variables: plain values the flows read as VARIABLES['name'] (shown, unlike secrets)
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

-- queue + history
CREATE TABLE runs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  flow_id uuid NOT NULL,
  parent_id uuid,
  mode text NOT NULL CHECK (mode IN ('execution', 'validation')),
  flow_version_id uuid,           -- required in execution (reads deployments)
  draft_hash text,                -- required in validation (reads the draft in flows)
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'with-warnings', 'with-errors', 'failed', 'cancelled')),
  trigger text NOT NULL CHECK (trigger IN ('manual', 'webhook', 'schedule', 'api')),
  worker_tag text NOT NULL DEFAULT 'default',
  priority int NOT NULL DEFAULT 0,
  parameters jsonb,
  input jsonb,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,                -- supervisor id + worker number that ran it
  heartbeat_at timestamptz,
  cancel_requested bool NOT NULL DEFAULT false,
  start_rss_bytes bigint,
  peak_rss_bytes bigint,
  cpu_ms bigint,
  duration_ms bigint,
  record jsonb,                   -- the RunRecord from @dataflow/core, with the components
  CHECK (mode <> 'execution' OR flow_version_id IS NOT NULL),
  CHECK (mode <> 'validation' OR draft_hash IS NOT NULL)
);
CREATE INDEX runs_queue ON runs (worker_tag, priority, queued_at) WHERE status = 'queued';
CREATE INDEX runs_by_org ON runs (org_id, queued_at DESC);
CREATE INDEX runs_running ON runs (heartbeat_at) WHERE status = 'running';

-- supervisor processes alive in this instance (each manages `workers` worker processes);
-- they serve every organization of the instance
CREATE TABLE supervisors (
  id text PRIMARY KEY,
  tags text[] NOT NULL,
  workers int NOT NULL,
  version text,
  last_seen timestamptz NOT NULL DEFAULT now()
);
