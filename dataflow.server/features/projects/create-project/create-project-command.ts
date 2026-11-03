import { z } from 'zod';

export const CreateProjectCommand = z.object({
  name: z.string().trim().min(1, 'Required').max(100, 'At most 100 characters'),
  description: z.string().trim().max(500, 'At most 500 characters').default(''),
});

export type CreateProjectCommand = z.output<typeof CreateProjectCommand>;

export type CreateProjectResponse = { id: string };
