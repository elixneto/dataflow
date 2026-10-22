import type {ReactNode} from 'react'
import {Link} from 'react-router'
import {Workflow} from 'lucide-react'
import {BotaoTema} from '@/ui/tema'

/** Cabeçalho das páginas fora do editor: marca, trilha (Projetos / ...) e ações à direita. */
export function Cabecalho({trilha = [], children}: {trilha?: {rotulo: string; para?: string}[]; children?: ReactNode}) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border px-6">
      <Link to="/" className="flex items-center gap-2 text-sm font-medium hover:text-primary">
        <Workflow className="size-5 text-primary" aria-hidden="true"/>
        Workflows
      </Link>
      {trilha.map((t, i) => (
        <span key={i} className="flex min-w-0 items-center gap-3 text-sm">
          <span className="text-muted-foreground" aria-hidden="true">/</span>
          {t.para ? <Link to={t.para} className="truncate text-muted-foreground hover:text-foreground">{t.rotulo}</Link> : <span className="truncate font-medium">{t.rotulo}</span>}
        </span>
      ))}
      <span className="ml-2 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground" title="Projetos e fluxos guardados só neste navegador">
        dados mockados
      </span>
      <div className="ml-auto flex items-center gap-2">
        <BotaoTema/>
        {children}
      </div>
    </header>
  )
}

export const dataCurta = (iso: string) => new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'})
