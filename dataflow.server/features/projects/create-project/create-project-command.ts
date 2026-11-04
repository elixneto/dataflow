import { z } from 'zod';
import { appearanceKey, projectDescription, projectName } from '../project-fields';

export const CreateProjectCommand = z.object({
  name: projectName,
  description: projectDescription.default(''),
  icon: appearanceKey.default('folder'),
  color: appearanceKey.default('blue'),
});

export type CreateProjectCommand = z.output<typeof CreateProjectCommand>;

export type CreateProjectResponse = { id: string };
