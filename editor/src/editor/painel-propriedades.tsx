import {useState} from 'react'
import {CircleAlert} from 'lucide-react'
import {POR_TIPO} from '@/componentes/catalogo'
import {cn} from '@/lib/utils'
import type {DadosDoComponente, NoComponente} from './no-componente'

type Aba = 'configuracao' | 'notes'

type Props = {
  no: NoComponente
  recebeLinhas: boolean
  onRotulo: (id: string, rotulo: string) => void
  onDados: (id: string, mudanca: Partial<Pick<DadosDoComponente, 'chaveDeSaida' | 'override' | 'notas'>>) => void
  onConfig: (id: string, chave: string, valor: unknown) => void
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30'

/** Corpo da janela de um componente: aba Configuração e aba Notes (anotação livre + documentação do componente). */
export function PainelPropriedades({no, recebeLinhas, onRotulo, onDados, onConfig}: Props) {
  const [aba, setAba] = useState<Aba>('configuracao')
  const def = POR_TIPO[no.data.tipo]
  const Conteudo = def.Painel ?? def.Card
  const Documentacao = def.Documentacao
  const pendencias = def.validar?.(no.data.config, {recebeLinhas}) ?? []

  return (
    <>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-sidebar-border px-3">
        {([['configuracao', 'Configuração'], ['notes', 'Notas']] as const).map(([valor, rotulo]) => (
          <button key={valor} type="button" role="tab" aria-selected={aba === valor} onClick={() => setAba(valor)}
                  className={cn('-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                    aba === valor ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {rotulo}
            {valor === 'notes' && no.data.notas?.trim() && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-comentario align-middle" aria-label="tem anotação"/>}
          </button>
        ))}
      </div>

      {aba === 'configuracao' ? (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-4 [&>*]:shrink-0">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${no.id}-rotulo`} className="text-xs font-medium text-muted-foreground">Label</label>
            <input id={`${no.id}-rotulo`} value={no.data.rotulo} onChange={e => onRotulo(no.id, e.target.value)} className={inputClass}/>
          </div>

          {def.chaveDeSaidaPadrao && !no.data.override && (
            <div className="flex flex-col gap-2">
              <label htmlFor={`${no.id}-chave`} className="text-xs font-medium text-muted-foreground">Chave no envelope</label>
              <div className="flex items-center gap-1">
                <span className="font-mono text-sm text-muted-foreground">$</span>
                <input id={`${no.id}-chave`} value={no.data.chaveDeSaida ?? ''} onChange={e => onDados(no.id, {chaveDeSaida: e.target.value})}
                       placeholder={def.chaveDeSaidaPadrao} className={`${inputClass} font-mono`}/>
              </div>
            </div>
          )}

          {def.usaOverride && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={no.data.override ?? false} onChange={e => onDados(no.id, {override: e.target.checked})} className="size-4"/>
              Override
            </label>
          )}

          {pendencias.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" aria-label="Pendências">
              {pendencias.map(p => (
                <li key={p} className="flex gap-2"><CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true"/><span>{p.charAt(0).toUpperCase() + p.slice(1)}</span></li>
              ))}
            </ul>
          )}

          {Conteudo && <Conteudo id={`painel-${no.id}`} noId={no.id} config={no.data.config} setConfig={(k, v) => onConfig(no.id, k, v)} recebeLinhas={recebeLinhas}/>}
        </div>
      ) : (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 [&>*]:shrink-0">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${no.id}-notas`} className="text-xs font-medium text-muted-foreground">Anotações</label>
            <textarea id={`${no.id}-notas`} value={no.data.notas ?? ''} onChange={e => onDados(no.id, {notas: e.target.value})}
                      placeholder="Anotações"
                      className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"/>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground [&_code]:font-mono [&_code]:text-foreground [&_h4]:mt-2 [&_h4]:text-xs [&_h4]:font-medium [&_h4]:uppercase [&_h4]:tracking-wider">
            {Documentacao ? <Documentacao/> : <p>{def.descricao}</p>}
          </div>
        </div>
      )}
    </>
  )
}
