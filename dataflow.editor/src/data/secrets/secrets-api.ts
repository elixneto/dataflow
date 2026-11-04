import { api, type ApiResult } from '@/lib/api';
import type { Secret } from './secret';

/* A project's secrets on dataflow.server: names only; a value goes in and never comes back. */

type SecretDto = Omit<Secret, 'createdAt' | 'updatedAt' | 'updatedBy'> & { createdAt: string; updatedAt: string; updatedBy: string | null };

export const toSecret = (dto: SecretDto): Secret => ({
  ...dto,
  updatedBy: dto.updatedBy ?? '',
  createdAt: new Date(dto.createdAt),
  updatedAt: new Date(dto.updatedAt),
});

/** the project's secrets by name, without their values */
export async function listSecrets(projectId: string): Promise<ApiResult<Secret[]>> {
  const result = await api<{ items: SecretDto[] }>(`/projects/${projectId}/secrets`);
  return result.ok ? { ok: true, value: result.value.items.map(toSecret) } : result;
}

export function createSecret(projectId: string, fields: { name: string; value: string }): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/projects/${projectId}/secrets`, { method: 'POST', body: fields });
}

/** replaces the value (the old one is not shown, nor returned) */
export async function updateSecretValue(_projectId: string, id: string, value: string): Promise<ApiResult<Secret>> {
  const result = await api<SecretDto>(`/secrets/${id}/value`, { method: 'PUT', body: { value } });
  return result.ok ? { ok: true, value: toSecret(result.value) } : result;
}

export function deleteSecret(_projectId: string, id: string): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/secrets/${id}`, { method: 'DELETE' });
}
