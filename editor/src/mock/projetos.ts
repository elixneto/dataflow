/*
 * Projetos mockados, guardados no localStorage do navegador (como os fluxos). Cada projeto tem fluxos, execuções,
 * segredos e arquivos; os três últimos já vêm do runner. Vira chamada à API quando o backend existir.
 */

export type Projeto = {
  id: string
  nome: string
  descricao: string
  atualizadoEm: string
  /** pastas criadas à mão (as que têm fluxo aparecem sozinhas), como caminho: "Vendas/Notas" */
  pastas?: string[]
}

export const PROJETO_DE_EXEMPLOS = 'exemplos'

const CHAVE = 'dataflow-projetos-v1'

const PADRAO = (): Projeto[] => [
  {id: PROJETO_DE_EXEMPLOS, nome: 'Exemplos', descricao: 'Um fluxo de exemplo para cada componente.', atualizadoEm: new Date().toISOString()},
]

/** Começa com os dois padrão; depois do primeiro gravar, vale o que está salvo. */
export function listarProjetos(): Projeto[] {
  try {
    const salvo = localStorage.getItem(CHAVE)
    if (salvo) return JSON.parse(salvo) as Projeto[]
  } catch {
    // storage indisponível ou corrompido: os padrão
  }
  return PADRAO()
}

function gravar(projetos: Projeto[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(projetos))
  } catch {
    // sem storage: o mock vale só até recarregar
  }
}

export function obterProjeto(id: string): Projeto | undefined {
  return listarProjetos().find(p => p.id === id)
}

/** id legível a partir do nome (vira pasta de arquivos e chave de segredos no runner) */
function idDoNome(nome: string, existentes: string[]) {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projeto'
  let id = base
  for (let n = 2; existentes.includes(id); n++) id = `${base}-${n}`
  return id
}

export function criarProjeto(nome: string, descricao: string): Projeto {
  const projetos = listarProjetos()
  const projeto: Projeto = {id: idDoNome(nome, projetos.map(p => p.id)), nome, descricao, atualizadoEm: new Date().toISOString()}
  gravar([...projetos, projeto])
  return projeto
}

export function salvarProjeto(projeto: Projeto) {
  gravar(listarProjetos().map(p => (p.id === projeto.id ? {...projeto, atualizadoEm: new Date().toISOString()} : p)))
}

export function excluirProjeto(id: string) {
  gravar(listarProjetos().filter(p => p.id !== id))
}

/** Guarda uma pasta vazia no projeto (a pasta de quem já tem fluxo não precisa). */
export function criarPasta(projetoId: string, caminho: string) {
  gravar(listarProjetos().map(p => (p.id === projetoId ? {...p, pastas: [...new Set([...(p.pastas ?? []), caminho])]} : p)))
}

/** Troca o caminho das pastas guardadas (renomear); `para` vazio apaga a pasta e as de dentro. */
export function trocarPastas(projetoId: string, de: string, para: string) {
  const dentro = (c: string) => c === de || c.startsWith(de + '/')
  gravar(listarProjetos().map(p => (p.id !== projetoId ? p : {
    ...p,
    pastas: (p.pastas ?? []).flatMap(c => (!dentro(c) ? [c] : para ? [para + c.slice(de.length)] : [])),
  })))
}
