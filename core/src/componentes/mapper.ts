import {comoErro, mesclar, problemaNoNome} from '../envelope'
import type {CampoComExpression, ComponenteLogica} from '../tipos'

/**
 * Mapper: grava campos direto no DATA (origem → destino), adicionando ou trocando o valor.
 * Ex.: "ABACAXI" → campo; depois, outro Mapper faz $campo + " 123" → outroCampo
 *      e o DATA fica {campo: "ABACAXI", outroCampo: "ABACAXI 123"}.
 * As origens são avaliadas sobre o envelope que chegou (a linha de cima não enxerga o que a de baixo grava).
 * Override: o DATA de saída leva só os campos mapeados.
 */

export type CampoDoMapper = CampoComExpression & {destino: string}

export function camposDoMapper(config: Record<string, unknown>): CampoDoMapper[] {
  return Array.isArray(config.campos) ? (config.campos as CampoDoMapper[]) : []
}

export const mapper: ComponenteLogica = {
  tipo: 'mapper',
  entradas: ['envelope'],
  saidas: ['envelope'],

  validar(config) {
    const campos = camposDoMapper(config)
    if (campos.length === 0) return ['não tem nenhum campo.']
    const pendencias: string[] = []
    const vistos = new Set<string>()
    campos.forEach((c, i) => {
      const problema = problemaNoNome(c.destino)
      if (problema) pendencias.push(`campo ${i + 1} ${problema}.`)
      else if (vistos.has(c.destino)) pendencias.push(`tem o campo "${c.destino}" repetido.`)
      vistos.add(c.destino)
      if (c.expression && !c.valor.trim()) pendencias.push(`campo "${c.destino || i + 1}" está como expression, mas vazio.`)
    })
    return pendencias
  },

  async* executar(entradas, config, ctx) {
    const campos = camposDoMapper(config)
    let mapeados = 0
    for await (const doc of entradas['in-0'] ?? []) {
      try {
        const saida: Record<string, unknown> = {}
        for (const campo of campos) saida[campo.destino] = ctx.valorDoCampo(campo, doc)
        mapeados += 1
        yield {porta: 'out-0', doc: mesclar(doc, saida, ctx.no.override)}
      } catch (e) {
        yield {erro: comoErro(e), doc}
      }
    }
    ctx.log('info', `${mapeados} envelope(s) mapeado(s): ${campos.map(c => c.destino).join(', ')}.`)
  },
}
