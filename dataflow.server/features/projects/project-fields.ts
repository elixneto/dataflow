import { z } from 'zod';
import type { Project } from './project';

/** The rules of a project's fields, shared by create and update. */

export const projectName = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');

export const projectDescription = z.string().trim().max(500, 'At most 500 characters');

/** an icon or color name: the editor owns the list (its project-appearance.ts), the server only checks the shape */
export const appearanceKey = z.string().regex(/^[a-z][a-z-]{0,31}$/, 'Invalid');

/** a project as the api answers it (list, update) */
export type ProjectView = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  createdAt: Date;
  /** when it was archived; null while it is active */
  archivedAt: Date | null;
};

export const toProjectView = (project: Project): ProjectView => ({
  id: project.id,
  name: project.name,
  description: project.description,
  icon: project.icon,
  color: project.color,
  createdAt: project.createdAt,
  archivedAt: project.deletedAt,
});
