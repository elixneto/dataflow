import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter, Navigate, Route, Routes} from 'react-router'
import './index.css'
import {ListaDeProjetos} from '@/paginas/lista-de-projetos'
import {PaginaDoProjeto} from '@/paginas/pagina-do-projeto'
import {PaginaDaExecucao} from '@/paginas/pagina-da-execucao'
import {PaginaDoEditor, RedirecionarFluxoAntigo} from '@/paginas/pagina-do-editor'
import {aplicarTemaSalvo} from '@/ui/tema'

aplicarTemaSalvo()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ListaDeProjetos/>}/>
        <Route path="/projetos/:projetoId" element={<PaginaDoProjeto/>}/>
        <Route path="/projetos/:projetoId/fluxos/:fluxoId" element={<PaginaDoEditor/>}/>
        <Route path="/projetos/:projetoId/execucoes/:execucaoId" element={<PaginaDaExecucao/>}/>
        {/* endereços antigos (antes dos projetos, o app ficava em /fluxos) */}
        <Route path="/editor/:fluxoId" element={<RedirecionarFluxoAntigo/>}/>
        <Route path="/fluxos/editor/:fluxoId" element={<RedirecionarFluxoAntigo/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
