import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/layout/app-shell';
import { FlowEditorPage } from '@/pages/flow-editor/flow-editor-page';
import { FlowsPage } from '@/pages/flows/flows-page';
import { HomePage } from '@/pages/home/home-page';
import { ConnectionsPage } from '@/pages/project-connections/connections-page';
import { ProjectFlowsPage } from '@/pages/project-flows/project-flows-page';
import { ScriptsPage } from '@/pages/project-scripts/scripts-page';
import { SecretsPage } from '@/pages/project-secrets/secrets-page';
import { OldFlowsUrl } from './old-flows-url';

/**
 * The pages inside the shell (sidebar + top bar): a new page is a new child here and an item in app-sidebar.tsx.
 * A project has tabs: flows, scripts, connections, secrets, files. The flow editor has the whole screen (its own top bar, no
 * sidebar), so it sits outside the shell. URLs in paths.ts.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'projects', element: <FlowsPage /> },
      { path: 'projects/:projectId', element: <Navigate to="flows" replace /> },
      { path: 'projects/:projectId/flows', element: <ProjectFlowsPage /> },
      { path: 'projects/:projectId/scripts', element: <ScriptsPage /> },
      { path: 'projects/:projectId/connections', element: <ConnectionsPage /> },
      { path: 'projects/:projectId/secrets', element: <SecretsPage /> },
      // Files is coming (its tab shows "Soon"); its screen stays in pages/project-files for when the server stores files
      { path: 'projects/:projectId/files', element: <Navigate to="../flows" relative="path" replace /> },
    ],
  },
  { path: '/projects/:projectId/flows/:flowId', element: <FlowEditorPage /> },
  { path: '/flows', element: <OldFlowsUrl /> },
  { path: '/flows/:projectId', element: <OldFlowsUrl /> },
  { path: '/flows/:projectId/:flowId', element: <OldFlowsUrl /> },
]);
