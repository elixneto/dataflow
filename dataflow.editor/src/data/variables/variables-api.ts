import { api, type ApiResult } from '@/lib/api';
import type { Variable } from './variable';

/* A project's variables on dataflow.server: plain values, shown and editable. */

type VariableDto = Omit<Variable, 'createdAt' | 'updatedAt' | 'updatedBy'> & { createdAt: string; updatedAt: string; updatedBy: string | null };

export const toVariable = (dto: VariableDto): Variable => ({
  ...dto,
  updatedBy: dto.updatedBy ?? '',
  createdAt: new Date(dto.createdAt),
  updatedAt: new Date(dto.updatedAt),
});

/** the project's variables by name, with their values */
export async function listVariables(projectId: string): Promise<ApiResult<Variable[]>> {
  const result = await api<{ items: VariableDto[] }>(`/projects/${projectId}/variables`);
  return result.ok ? { ok: true, value: result.value.items.map(toVariable) } : result;
}

export function createVariable(projectId: string, fields: { name: string; value: string }): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/projects/${projectId}/variables`, { method: 'POST', body: fields });
}

/** changes the value (the name stays: flows refer to it) */
export async function updateVariable(_projectId: string, id: string, value: string): Promise<ApiResult<Variable>> {
  const result = await api<VariableDto>(`/variables/${id}`, { method: 'PATCH', body: { value } });
  return result.ok ? { ok: true, value: toVariable(result.value) } : result;
}

export function deleteVariable(_projectId: string, id: string): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/variables/${id}`, { method: 'DELETE' });
}
