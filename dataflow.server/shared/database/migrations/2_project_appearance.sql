-- How a project shows in the editor's lists: an icon and its color, by name. The editor owns the list of names.

ALTER TABLE projects
  ADD COLUMN icon text NOT NULL DEFAULT 'folder',
  ADD COLUMN color text NOT NULL DEFAULT 'blue';
