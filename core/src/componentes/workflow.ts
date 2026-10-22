import {comoErro, mesclar} from '../envelope'
import type {CampoComExpression, ComponenteLogica} from '../tipos'

/**
 * Workflow Invoker (no SnapLogic, Pipeline Execute): para cada envelope que chega, roda outro workflow, passando os
 * parâmetros do Start dele (texto ou expression no envelope) e, se marcado, o DATA do envelope como entrada.
 * Cada envelope que chega ao End do outro sai daqui com o DATA dele mesclado no do envelope que chamou
 * (Override = só o do outro). Se o outro falhar, é erro do envelope que chamou e segue a política "Em caso de erro":
 * com Desviar, a porta de erro pode chamar um terceiro workflow. Chamada circular e mais de 10 níveis são barrados.
 */

export type ParametroDoInvoker = CampoComExpression & {nome: string}

export function configDoWorkflowInvoker(config: Record<string, unknown>) {
  return {
    workflowId: typeof config.workflowId === 'string' ? config.workflowId : '',
    parametros: Array.isArray(config.parametros) ? (config.parametros as ParametroDoInvoker[]) : [],
    enviarEnvelope: config.enviarEnvelope === true,
  }
}

export const workflowInvoker: ComponenteLogica = {
  tipo: 'workflow',
  entradas: ['envelope'],
  saidas: ['envelope'],

  validar(config) {
    return configDoWorkflowInvoker(config).workflowId ? [] : ['não tem workflow escolhido.']
  },

  async* executar(entradas, config, ctx) {
    const {workflowId, parametros, enviarEnvelope} = configDoWorkflowInvoker(config)
    let chamadas = 0
    let saidas = 0
    for await (const doc of entradas['in-0'] ?? []) {
      chamadas += 1
      let chamada: ReturnType<typeof ctx.invocarWorkflow> | undefined
      try {
        // campo vazio fica de fora: o outro workflow usa o padrão do parâmetro
        const valores: Record<string, string> = {}
        for (const p of parametros) {
          if (!p.expression && p.valor === '') continue
          const valor = ctx.valorDoCampo(p, doc)
          if (valor !== undefined && valor !== null) valores[p.nome] = typeof valor === 'object' ? JSON.stringify(valor) : String(valor)
        }
        chamada = ctx.invocarWorkflow(workflowId, {parametros: valores, entrada: enviarEnvelope ? doc.DATA : undefined})
        let destaChamada = 0
        // esperar o outro workflow não é tempo ativo deste
        for await (const data of ctx.esperarCada(chamada.envelopes)) {
          destaChamada += 1
          yield {porta: 'out-0', doc: mesclar(doc, data, ctx.no.override)}
        }
        saidas += destaChamada
        const registro = await ctx.esperar(chamada.resultado)
        if (registro.status === 'falhou') {
          throw Object.assign(new Error(`O workflow "${registro.run.workflow}" falhou: ${registro.erro ?? 'sem detalhe'}`), {name: 'WorkflowError'})
        }
        ctx.log(registro.status === 'concluida' ? 'info' : 'aviso',
          `Chamada ${chamadas}: "${registro.run.workflow}" ${registro.status === 'concluida' ? 'concluído' : registro.status.replace('-', ' ')} em ${registro.duracaoMs} ms, ${destaChamada} envelope(s) no End.`)
      } catch (e) {
        yield {erro: comoErro(e), doc}
      } finally {
        chamada?.cancelar()
      }
    }
    ctx.log('info', `${chamadas} chamada(s), ${saidas} envelope(s) devolvido(s).`)
  },
}
