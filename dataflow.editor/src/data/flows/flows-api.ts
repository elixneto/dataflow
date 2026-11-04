import { api, type ApiResult } from '@/lib/api';
import type { Flow, Folder, ProjectContents } from './flow';

/*
 * A project's folders and flows on dataflow.server. Folders are only organization: moving or renaming a flow keeps its
 * id and needs no deploy. Dates come as ISO text and become Date here.
 */

type FolderDto = Omit<Folder, 'createdAt' | 'archivedAt'> & { createdAt: string; archivedAt: string | null };
type FlowDto = Omit<Flow, 'createdAt' | 'updatedAt' | 'archivedAt' | 'updatedBy'> & {
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
};

const date = (text: string | null) => (text === null ? null : new Date(text));

export const toFolder = (dto: FolderDto): Folder => ({
  ...dto,
  createdAt: new Date(dto.createdAt),
  archivedAt: date(dto.archivedAt),
});

export const toFlow = (dto: FlowDto): Flow => ({
  ...dto,
  updatedBy: dto.updatedBy ?? '',
  createdAt: new Date(dto.createdAt),
  updatedAt: new Date(dto.updatedAt),
  archivedAt: date(dto.archivedAt),
});

const map = <T, U>(result: ApiResult<T>, convert: (value: T) => U): ApiResult<U> =>
  result.ok ? { ok: true, value: convert(result.value) } : result;

/** everything the project holds, archived included */
export async function getProjectContents(projectId: string): Promise<ApiResult<ProjectContents>> {
  const result = await api<{ folders: FolderDto[]; flows: FlowDto[] }>(`/projects/${projectId}/contents`);
  return map(result, value => ({ folders: value.folders.map(toFolder), flows: value.flows.map(toFlow) }));
}

export async function getFlow(id: string): Promise<ApiResult<Flow>> {
  return map(await api<FlowDto>(`/flows/${id}`), toFlow);
}

// ---- folders

export function createFolder(projectId: string, parentId: string | null, name: string): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/projects/${projectId}/folders`, { method: 'POST', body: { name, parentId } });
}

export async function renameFolder(id: string, name: string): Promise<ApiResult<Folder>> {
  return map(await api<FolderDto>(`/folders/${id}`, { method: 'PATCH', body: { name } }), toFolder);
}

/** into another folder, or to the root (null), with everything under it */
export async function moveFolder(id: string, parentId: string | null): Promise<ApiResult<Folder>> {
  return map(await api<FolderDto>(`/folders/${id}/move`, { method: 'POST', body: { parentId } }), toFolder);
}

/** archives the folder and everything under it */
export function archiveFolder(id: string): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/folders/${id}/archive`, { method: 'POST' });
}

/** brings the folder back with what went with it; to the root when the folder it was in is gone */
export async function restoreFolder(id: string): Promise<ApiResult<Folder>> {
  return map(await api<FolderDto>(`/folders/${id}/restore`, { method: 'POST' }), toFolder);
}

// ---- flows

export function createFlow(projectId: string, fields: { name: string; folderId: string | null }): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/projects/${projectId}/flows`, { method: 'POST', body: fields });
}

export async function renameFlow(id: string, name: string): Promise<ApiResult<Flow>> {
  return map(await api<FlowDto>(`/flows/${id}`, { method: 'PATCH', body: { name } }), toFlow);
}

export async function moveFlow(id: string, folderId: string | null): Promise<ApiResult<Flow>> {
  return map(await api<FlowDto>(`/flows/${id}/move`, { method: 'POST', body: { folderId } }), toFlow);
}

export function archiveFlow(id: string): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/flows/${id}/archive`, { method: 'POST' });
}

/** brings the flow back into its folder; to the root when that folder is archived or gone */
export async function restoreFlow(id: string): Promise<ApiResult<Flow>> {
  return map(await api<FlowDto>(`/flows/${id}/restore`, { method: 'POST' }), toFlow);
}
