import { Navigate, useLocation, useParams } from 'react-router';
import { flowPath, projectPath, PROJECTS_PATH } from './paths';

/** the old /flows/... links (before /projects/...) still land on the right page, with their ?status= / ?folder= */
export function OldFlowsUrl() {
  const { projectId, flowId } = useParams();
  const { search } = useLocation();
  const to = projectId && flowId ? flowPath(projectId, flowId) : projectId ? projectPath(projectId) : PROJECTS_PATH;
  return <Navigate to={`${to}${search}`} replace />;
}
