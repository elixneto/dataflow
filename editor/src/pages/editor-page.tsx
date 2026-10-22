import {useMemo} from 'react';
import {Link, Navigate, useParams, useSearchParams} from 'react-router';
import {FlowEditor} from '#editor/editor';
import {emptyFlow, getFlow, saveFlow} from '#mock/flows';

export function EditorPage() {
  const {projectId = '', flowId} = useParams();
  // a new flow is born in the folder that was open
  const folder = useSearchParams()[0].get('folder') ?? '';
  const flow = useMemo(() => (flowId === 'new' ? emptyFlow(projectId, folder) : getFlow(flowId ?? '')), [flowId, projectId, folder]);

  if (!flow) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        Flow not found.
        <Link to={`/projects/${projectId}`} className="text-primary hover:underline">Back to the project</Link>
      </div>
    );
  }

  // key: switching flows recreates the editor from scratch (React Flow state and history)
  return <FlowEditor key={flow.id} flow={flow} onSave={f => {
    const saved = saveFlow(f);
    if (flowId === 'new') window.history.replaceState(null, '', `/projects/${saved.projectId}/flows/${saved.id}`);
    return saved;
  }}/>;
}

/** Old link (/editor/:id): sends to the flow inside its project. */
export function RedirectLegacyFlow() {
  const {flowId = ''} = useParams();
  const flow = getFlow(flowId);
  return <Navigate to={flow ? `/projects/${flow.projectId}/flows/${flow.id}` : '/'} replace/>;
}
