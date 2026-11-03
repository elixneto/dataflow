import {useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router';
import type {RunRecord} from '@dataflow/core';
import {RunResult} from '#run/run-panel';
import {getProject} from '#data/projects';
import {Header} from '#pages/header';

type StoredRun = RunRecord & {workflowId?: string};

/** Detail of a run (Logs, Metrics and Data), opened from the project's Runs tab. */
export function RunPage() {
  const {projectId = '', runId = ''} = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<StoredRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = getProject(projectId);

  useEffect(() => {
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Run not found (the runner keeps only the latest ones, in memory).' : `The runner returned ${r.status}.`))))
      .then(setRecord)
      .catch(e => setError(e instanceof TypeError ? 'The runner did not respond.' : e.message));
  }, [runId]);

  const back = `/projects/${projectId}?tab=runs`;
  return (
    <div className="flex h-dvh flex-col bg-background">
      <Header breadcrumb={[{label: project?.name ?? projectId, to: `/projects/${projectId}`}, {label: 'Runs', to: back}, {label: record?.run.workflow ?? runId.slice(0, 8)}]}>
        {record?.workflowId && (
          <Link to={`/projects/${projectId}/flows/${record.workflowId}`} className="text-sm text-primary hover:underline">Open the flow</Link>
        )}
      </Header>
      {error && <p className="m-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {record && (
        <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col border-x border-border bg-sidebar" aria-label="Run result">
          <RunResult record={record} portName={(_, port) => port}
                     onGoTo={() => record.workflowId && navigate(`/projects/${projectId}/flows/${record.workflowId}`)}/>
        </section>
      )}
    </div>
  );
}
