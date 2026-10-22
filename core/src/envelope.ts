import type {Envelope, TipoDePorta} from './tipos'

/** Nomes que não podem ser chave do DATA (são as variáveis do sistema nas expressions). */
export const NOMES_RESERVADOS = ['WORKFLOW_CURRENT_RUN', 'PARAMETERS', 'SECRETS', 'DATA']

const IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Pendência do nome de uma chave de saída (ou de um campo), ou null se está ok. */
export function problemaNoNome(nome: string): string | null {
  if (!nome) return 'está sem nome'
  if (!IDENTIFICADOR.test(nome)) return `"${nome}" não é um nome válido (letras, números e _, sem começar por número)`
  if (NOMES_RESERVADOS.includes(nome)) return `"${nome}" é um nome reservado`
  return null
}

/**
 * Variáveis que uma expression enxerga num envelope: as do sistema e, direto, cada chave do DATA.
 * Ex.: $PARAMETERS.prefixo, $WORKFLOW_CURRENT_RUN.startedAt, $linhaCsv.NOME.
 */
export function variaveisDoEnvelope(doc: Envelope, segredos: Record<string, string> = {}): Record<string, unknown> {
  const variaveis: Record<string, unknown> = {
    $WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    $PARAMETERS: doc.PARAMETERS,
    $SECRETS: segredos,
  }
  for (const [chave, valor] of Object.entries(doc.DATA)) variaveis[`$${chave}`] = valor
  return variaveis
}

/** Novo envelope com a chave do componente no DATA (Override: só ela). */
export function acrescentar(doc: Envelope, chave: string, valor: unknown, override = false): Envelope {
  return {
    WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    PARAMETERS: doc.PARAMETERS,
    DATA: override ? {[chave]: valor} : {...doc.DATA, [chave]: valor},
  }
}

/** Novo envelope com os campos gravados direto no DATA (adiciona ou troca). Override: só esses campos. */
export function mesclar(doc: Envelope, campos: Record<string, unknown>, override = false): Envelope {
  return {
    WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    PARAMETERS: doc.PARAMETERS,
    DATA: override ? {...campos} : {...doc.DATA, ...campos},
  }
}

export const TIPOS_DE_PORTA: Record<TipoDePorta, string> = {
  envelope: 'Envelopes',
  texto: 'Texto',
  numero: 'Número',
  json: 'JSON',
  qualquer: 'Qualquer',
}

/** Uma saída pode ligar numa entrada quando o tipo é o mesmo ou um dos lados é `qualquer`. */
export function portasCompativeis(saida: TipoDePorta, entrada: TipoDePorta) {
  return saida === entrada || saida === 'qualquer' || entrada === 'qualquer'
}

/**
 * Normaliza qualquer coisa lançada num Error, mantendo o tipo (name). Erros vindos do node:vm são de outro
 * "realm" e não passam no `instanceof Error`, por isso a checagem é pelo formato.
 */
export function comoErro(e: unknown): Error {
  if (e instanceof Error) return e
  if (e && typeof e === 'object' && 'message' in e) {
    const erro = new Error(String((e as {message: unknown}).message))
    erro.name = 'name' in e ? String((e as {name: unknown}).name) : 'Error'
    return erro
  }
  return new Error(String(e))
}

/**
 * Procura um ciclo nas ligações (o workflow tem que ser acíclico: um ciclo é loop infinito de envelopes).
 * Devolve os ids do ciclo na ordem (o primeiro se repete no fim), ou null.
 */
export function encontrarCiclo(ids: string[], ligacoes: {origem: string; destino: string}[]): string[] | null {
  const saidas = new Map(ids.map(id => [id, ligacoes.filter(l => l.origem === id).map(l => l.destino)]))
  const estado = new Map<string, 'visitando' | 'feito'>()
  const pilha: string[] = []
  function visitar(id: string): string[] | null {
    estado.set(id, 'visitando')
    pilha.push(id)
    for (const prox of saidas.get(id) ?? []) {
      if (estado.get(prox) === 'visitando') return [...pilha.slice(pilha.indexOf(prox)), prox]
      if (!estado.has(prox)) {
        const ciclo = visitar(prox)
        if (ciclo) return ciclo
      }
    }
    pilha.pop()
    estado.set(id, 'feito')
    return null
  }
  for (const id of ids) {
    if (!estado.has(id)) {
      const ciclo = visitar(id)
      if (ciclo) return ciclo
    }
  }
  return null
}
