import { z } from 'zod';
import { appearanceKey, projectDescription, projectName, type ProjectView } from '../project-fields';

/** only the fields that change; at least one */
export const UpdateProjectCommand = z
  .object({
    id: z.uuid('Invalid'),
    name: projectName.optional(),
    description: projectDescription.optional(),
    icon: appearanceKey.optional(),
    color: appearanceKey.optional(),
  })
  .refine(command => Object.keys(command).some(key => key !== 'id'), { message: 'Nothing to change' });

export type UpdateProjectCommand = z.output<typeof UpdateProjectCommand>;

export type UpdateProjectResponse = ProjectView;
