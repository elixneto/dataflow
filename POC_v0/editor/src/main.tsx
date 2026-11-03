import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router';
import './index.css';
import {ProjectList} from '#pages/project-list';
import {ProjectPage} from '#pages/project-page';
import {RunPage} from '#pages/run-page';
import {EditorPage, RedirectLegacyFlow} from '#pages/editor-page';
import {applySavedTheme} from '#ui/theme';
import {SaveStatus} from '#ui/save-status';
import {Button} from '#ui/button';
import {loadWorkspace} from '#data/workspace';

applySavedTheme();

const root = createRoot(document.getElementById('root')!);

/** Projects and flows come from the runner: without it there is nothing to show yet. */
function Unavailable({message}: {message: string}) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
      {message}
      <Button size="sm" onClick={start}>Try again</Button>
    </div>
  );
}

function start() {
  loadWorkspace().then(render, error => root.render(<Unavailable message={error instanceof Error ? error.message : String(error)}/>));
}

const render = () => root.render(
  <StrictMode>
    <SaveStatus/>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectList/>}/>
        <Route path="/projects/:projectId" element={<ProjectPage/>}/>
        <Route path="/projects/:projectId/flows/:flowId" element={<EditorPage/>}/>
        <Route path="/projects/:projectId/runs/:runId" element={<RunPage/>}/>
        {/* old address (before projects, the editor lived at /editor) */}
        <Route path="/editor/:flowId" element={<RedirectLegacyFlow/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

start();
