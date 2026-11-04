-- a project's scripts: TypeScript modules in folders that a TypeScript component imports by their path
-- (`@myproject/scripts/<path>`). `exports`: the names each one exports (the editor offers them to import without
-- loading every script). `script_folders` keeps the folders that hold no script yet.
CREATE TABLE scripts (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid NOT NULL REFERENCES projects,
  path text NOT NULL,
  content text NOT NULL DEFAULT '',
  exports jsonb NOT NULL DEFAULT '[]',
  revision int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scripts_project_path ON scripts (project_id, path);

CREATE TABLE script_folders (
  org_id uuid NOT NULL REFERENCES organizations,
  project_id uuid NOT NULL REFERENCES projects,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);

-- a script's code as a run took it, by the sha256 of the code: written once, never changed, shared by every run that
-- took the same code
CREATE TABLE script_blobs (
  org_id uuid NOT NULL REFERENCES organizations,
  hash text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, hash)
);

-- what a run imports: {path: hash} of the scripts its TypeScript components import (and those import), as they were
-- when it was queued
ALTER TABLE runs ADD COLUMN scripts jsonb;
ALTER TABLE test_runs ADD COLUMN scripts jsonb;
