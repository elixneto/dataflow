import { isProjectColor, isProjectIcon, type ProjectColorName, type ProjectIconName } from './project-appearance';

/*
 * Projects as the editor sees them (projects-api.ts loads and saves them on dataflow.server). validateNewProject has the
 * same rules as the server's create-project, for instant feedback in the form; the server checks again.
 * icon and color are names from project-appearance.ts: the editor owns that list, the server stores the names.
 */

export type Project = {
  id: string;
  name: string;
  description: string;
  icon: ProjectIconName;
  color: ProjectColorName;
  createdAt: Date;
  /** when it was archived; null while it is active */
  archivedAt: Date | null;
};

export type NewProject = Pick<Project, 'name' | 'description' | 'icon' | 'color'>;

export type NewProjectErrors = Partial<Record<keyof NewProject, string>>;

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 500;

/** the fields trimmed, and the error of each invalid one (none = can be saved); `exceptId` is the project being edited */
export function validateNewProject(
  input: NewProject,
  existing: Project[],
  exceptId?: string,
): { value: NewProject; errors: NewProjectErrors } {
  const value = { ...input, name: input.name.trim(), description: input.description.trim() };
  const errors: NewProjectErrors = {};

  if (value.name === '') {
    errors.name = 'Required';
  } else if (value.name.length > NAME_MAX) {
    errors.name = `At most ${NAME_MAX} characters`;
  } else if (existing.some(project => project.id !== exceptId && project.name.toLowerCase() === value.name.toLowerCase())) {
    errors.name = 'Already in use';
  }

  if (value.description.length > DESCRIPTION_MAX) {
    errors.description = `At most ${DESCRIPTION_MAX} characters`;
  }

  if (!isProjectIcon(value.icon)) {
    errors.icon = 'Unknown icon';
  }

  if (!isProjectColor(value.color)) {
    errors.color = 'Unknown color';
  }

  return { value, errors };
}
