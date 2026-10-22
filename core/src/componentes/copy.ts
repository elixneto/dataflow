import type {ComponenteLogica} from '../tipos'

/**
 * Copy: o contrário do Union. Manda cada envelope que chega para todas as saídas (2 a 10), para o mesmo dado seguir
 * por caminhos diferentes (no SnapLogic, Copy; no Kettle, "copiar linhas para os próximos passos").
 * Cada saída recebe a sua cópia do envelope, para um caminho não mexer no que o outro recebe (ex.: um script que
 * altera o $input). O ritmo é o do caminho mais lento: o envelope só segue quando todas as saídas aceitaram.
 */

export const MIN_SAIDAS_DO_COPY = 2
export const MAX_SAIDAS_DO_COPY = 10

export function qtdSaidasDoCopy(config: Record<string, unknown>) {
  const n = Number(config.qtdSaidas ?? MIN_SAIDAS_DO_COPY)
  return Math.min(MAX_SAIDAS_DO_COPY, Math.max(MIN_SAIDAS_DO_COPY, Number.isFinite(n) ? Math.round(n) : MIN_SAIDAS_DO_COPY))
}

export const copy: ComponenteLogica = {
  tipo: 'copy',
  entradas: ['envelope'],
  saidas: ['envelope'],
  saidasVariaveis: {min: MIN_SAIDAS_DO_COPY, max: MAX_SAIDAS_DO_COPY, chave: 'qtdSaidas'},

  validar() {
    return []
  },

  async* executar(entradas, config, ctx) {
    const qtd = qtdSaidasDoCopy(config)
    let entrou = 0
    for await (const doc of entradas['in-0'] ?? []) {
      entrou += 1
      // copia antes de soltar: a primeira saída pode começar a mexer no envelope enquanto as outras esperam
      const copias = Array.from({length: qtd - 1}, () => structuredClone(doc))
      yield {porta: 'out-0', doc}
      for (let i = 1; i < qtd; i++) yield {porta: `out-${i}`, doc: copias[i - 1]}
    }
    ctx.log('info', `${entrou} envelope(s) copiado(s) para ${qtd} saídas.`)
  },
}
