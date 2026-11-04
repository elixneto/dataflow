-- Folders: only a visual organization of a project's flows, nested to any depth. A flow's folder and name live on the
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

ALTER TABLE flows
  ADD COLUMN folder_id uuid REFERENCES folders,  -- null = at the project's root
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX flows_live_name ON flows (project_id, COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'), lower(name))
  WHERE deleted_at IS NULL;
