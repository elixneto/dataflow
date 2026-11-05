import type { FlowCall, FlowFile, ScriptUse, RunProgress, RunRecord } from '@dataflow/core';
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

/** the draft the editor opens: the core's flow file and the revision it is at */
export type FlowDraft = { flow: FlowFile; revision: number };

export function getDraft(id: string): Promise<ApiResult<FlowDraft>> {
  return api<FlowDraft>(`/flows/${id}/draft`);
}

/**
 * saves the draft from the revision it started from; a conflict when another save came in between. `keepalive`: sent
 * while the page closes
 */
export function saveDraft(id: string, revision: number, flow: FlowFile, keepalive = false): Promise<ApiResult<{ revision: number }>> {
  return api<{ revision: number }>(`/flows/${id}/draft`, { method: 'PUT', body: { revision, flow }, keepalive });
}

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

// ---- runs

/** a run as the editor follows it: its status, and its record once it ended */
export type RunView = {
  id: string;
  flowId: string;
  mode: 'validation' | 'execution';
  status: 'queued' | 'running' | 'completed' | 'with-warnings' | 'with-errors' | 'failed' | 'cancelled';
  record: RunRecord | RunProgress | null;
  /** what its worker process used, once it ended (none for older runs) */
  usage: RunUsage | null;
};

/** a run's worker process: its memory at the start and its peak (the whole process, Bun included), its CPU time */
export type RunUsage = { startRssBytes: number | null; peakRssBytes: number | null; cpuMs: number | null };

/**
 * queues a run of the flow's saved draft: a test run (validation; it replaces this user's previous test run of the flow)
 * or for real (execution); with fromNodeId, Run from here: that component and what follows it, from what reached it in
 * the last run (the server takes it from the run it kept); the run's id right away
 */
export function startRun(flowId: string, mode: 'validation' | 'execution', from?: { nodeId: string; label: string }): Promise<ApiResult<{ id: string }>> {
  return api<{ id: string }>(`/flows/${flowId}/runs`, { method: 'POST', body: { mode, ...(from ? { fromNodeId: from.nodeId, fromLabel: from.label } : {}) } });
}

/** Stop: a queued run is cancelled at once, a running one stops at its next step; its status now */
export function cancelRun(id: string): Promise<ApiResult<{ id: string; status: RunView['status'] }>> {
  return api<{ id: string; status: RunView['status'] }>(`/runs/${id}/cancel`, { method: 'POST' });
}

export function getRun(id: string): Promise<ApiResult<RunView>> {
  return api<RunView>(`/runs/${id}`);
}

/** what the editor shows of a flow's runs when it opens: its latest run that ended (test or real) and the full test run */
export type LastRun = {
  last: { id: string; mode: 'validation' | 'execution'; finishedAt: string; record: RunRecord; usage: RunUsage | null } | null;
  full: RunRecord | null;
};

export function getLastRun(flowId: string): Promise<ApiResult<LastRun>> {
  return api<LastRun>(`/flows/${flowId}/last-run`);
}

/** the calls between a project's flows (their Flow Invokers, from the drafts), the flows they name and the circular chains */
export type FlowCalls = {
  flows: { id: string; name: string; folder: string; available: boolean }[];
  calls: FlowCall[];
  cycles: string[][];
  /** the project's scripts (paths), the ones the flows use, and what each script imports from the others */
  scripts: string[];
  scriptUses: ScriptUse[];
  scriptImports: { from: string; to: string }[];
};

export async function getFlowCalls(projectId: string): Promise<ApiResult<FlowCalls>> {
  const result = await api<FlowCalls>(`/projects/${projectId}/calls`);
  // a server from before the scripts sends none of their fields: no scripts then
  return result.ok ? { ...result, value: { ...result.value, scripts: result.value.scripts ?? [], scriptUses: result.value.scriptUses ?? [], scriptImports: result.value.scriptImports ?? [] } } : result;
}
