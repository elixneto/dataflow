import {Plus, X} from 'lucide-react'
import {problemaNoNome, type ParametroDoWorkflow, type TipoDeParametro} from '@dataflow/core'
import {inputCampo} from '@/ui/campo-expression'

const TIPOS: {valor: TipoDeParametro; rotulo: string}[] = [
  {valor: 'texto', rotulo: 'Texto'},
  {valor: 'numero', rotulo: 'Número'},
  {valor: 'booleano', rotulo: 'Sim/não'},
]

function erroDeJson(texto: string) {
  if (!texto.trim()) return null
  try {
    JSON.parse(texto)
    return null
  } catch (e) {
    return `JSON inválido: ${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * Painel do Início: os parâmetros que o workflow espera. Cada gatilho (endpoint, agendamento) passa os valores;
 * o que faltar usa o padrão. Nas expressions: $PARAMETERS.nome.
 */
export function PainelDoWorkflow({parametros, onChange, recebeEntrada, onRecebeEntrada, entradaDeTeste, onEntradaDeTeste}: {
  parametros: ParametroDoWorkflow[]
  onChange: (parametros: ParametroDoWorkflow[]) => void
  recebeEntrada: boolean
  onRecebeEntrada: (sim: boolean) => void
  entradaDeTeste: string
  onEntradaDeTeste: (json: string) => void
}) {
  const erroNaEntrada = erroDeJson(entradaDeTeste)
  const alterar = (i: number, mudanca: Partial<ParametroDoWorkflow>) => onChange(parametros.map((p, j) => (j === i ? {...p, ...mudanca} : p)))
  const nomes = parametros.map(p => p.nome)

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0">
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={recebeEntrada} onChange={e => onRecebeEntrada(e.target.checked)} className="size-4"/>
            Recebe entrada
          </label>
          {recebeEntrada && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="entrada-de-teste" className="text-xs font-medium text-muted-foreground">Entrada Padrão (JSON)</label>
              <textarea id="entrada-de-teste" value={entradaDeTeste} onChange={e => onEntradaDeTeste(e.target.value)} spellCheck={false}
                        placeholder={'{"nome": "Élix"}'}
                        className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"/>
              {erroNaEntrada && <span className="text-xs text-destructive">{erroNaEntrada}</span>}
            </div>
          )}
        </section>


        {parametros.map((p, i) => {
          const problema = problemaNoNome(p.nome) ?? (nomes.indexOf(p.nome) !== i ? `"${p.nome}" repetido` : null)
          return (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">$PARAMETERS.</span>
                <input value={p.nome} onChange={e => alterar(i, {nome: e.target.value})} placeholder="nome"
                       aria-label={`Nome do parâmetro ${i + 1}`} className={`${inputCampo} font-mono`}/>
                <button type="button" onClick={() => onChange(parametros.filter((_, j) => j !== i))} aria-label="Remover parâmetro"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="size-4" aria-hidden="true"/>
                </button>
              </div>
              {problema && <span className="text-xs text-destructive">{problema}</span>}
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <select value={p.tipo} onChange={e => alterar(i, {tipo: e.target.value as TipoDeParametro})} className={inputCampo} aria-label="Tipo">
                  {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                </select>
                {p.tipo === 'booleano' ? (
                  <select value={p.padrao} onChange={e => alterar(i, {padrao: e.target.value})} className={inputCampo} aria-label="Valor padrão">
                    <option value="false">Não</option>
                    <option value="true">Sim</option>
                  </select>
                ) : (
                  <input value={p.padrao} onChange={e => alterar(i, {padrao: e.target.value})} placeholder="valor padrão"
                         inputMode={p.tipo === 'numero' ? 'decimal' : undefined} aria-label="Valor padrão" className={inputCampo}/>
                )}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" checked={p.obrigatorio ?? false} onChange={e => alterar(i, {obrigatorio: e.target.checked})} className="size-3.5"/>
                Obrigatório
              </label>
            </div>
          )
        })}

        <button type="button" onClick={() => onChange([...parametros, {nome: '', tipo: 'texto', padrao: ''}])}
                className="flex h-9 items-center justify-center gap-1 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:border-ring hover:text-foreground">
          <Plus className="size-4" aria-hidden="true"/> Adicionar parâmetro
        </button>
      </div>
    </>
  )
}
