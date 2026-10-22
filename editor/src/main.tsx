import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter, Navigate, Route, Routes} from 'react-router'
import './index.css'
import {ProjectList} from '@/pages/project-list'
import {ProjectPage} from '@/pages/project-page'
import {RunPage} from '@/pages/run-page'
import {EditorPage, RedirectLegacyFlow} from '@/pages/editor-page'
import {applySavedTheme} from '@/ui/theme'

applySavedTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
)
