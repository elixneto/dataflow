import {mkdir, readdir, rm, stat} from 'node:fs/promises'
import {Hono} from 'hono'

/*
 * O que é de cada projeto e fica no runner enquanto não há banco: segredos e arquivos.
 * Segredos: runner/secrets.local.json (fora do git). Valor de texto no topo vale para todos os projetos (compartilhado);
 * os de um projeto ficam em "projetos": {"<projetoId>": {"NOME": "valor"}} e ganham do compartilhado com o mesmo nome.
 * A API nunca devolve valor de segredo, só os nomes.
 * Arquivos: runner/arquivos.local/<projetoId>/ (fora do git).
 */

const ARQUIVO_DE_SEGREDOS = new URL('../secrets.local.json', import.meta.url)
const PASTA_DE_ARQUIVOS = new URL('../arquivos.local/', import.meta.url)

type ArquivoDeSegredos = Record<string, unknown> & {projetos?: Record<string, Record<string, string>>}

async function lerArquivoDeSegredos(): Promise<ArquivoDeSegredos> {
  const arquivo = Bun.file(ARQUIVO_DE_SEGREDOS)
  if (!(await arquivo.exists())) return {}
  try {
    return await arquivo.json()
  } catch {
    console.error('secrets.local.json não é um JSON válido; seguindo sem segredos.')
    return {}
  }
}

const compartilhados = (conteudo: ArquivoDeSegredos) =>
  Object.fromEntries(Object.entries(conteudo).filter(([, v]) => typeof v === 'string')) as Record<string, string>

/** Segredos de uma execução: os compartilhados e, por cima, os do projeto. Lido a cada execução (dá para mudar sem reiniciar). */
export async function segredosDoProjeto(projetoId?: string): Promise<Record<string, string>> {
  const conteudo = await lerArquivoDeSegredos()
  return {...compartilhados(conteudo), ...(projetoId ? conteudo.projetos?.[projetoId] ?? {} : {})}
}

const NOME_DE_SEGREDO = /^[A-Za-z_][A-Za-z0-9_]*$/
/** id de projeto e nome de arquivo viram caminho: nada de "..", barra ou caractere estranho */
const ID_SEGURO = /^[A-Za-z0-9_-]+$/
const nomeDeArquivoSeguro = (nome: string) => !!nome && nome.length <= 200 && !/[\\/:*?"<>|]/.test(nome) && nome !== '.' && nome !== '..'

export const rotasDeProjetos = new Hono()

rotasDeProjetos.use('/projetos/:projetoId/*', async (c, next) => {
  if (!ID_SEGURO.test(c.req.param('projetoId'))) return c.json({erro: 'Projeto inválido.'}, 400)
  await next()
})

rotasDeProjetos.get('/projetos/:projetoId/segredos', async c => {
  const conteudo = await lerArquivoDeSegredos()
  const doProjeto = Object.keys(conteudo.projetos?.[c.req.param('projetoId')] ?? {})
  const todos = Object.keys(compartilhados(conteudo))
  return c.json([
    ...doProjeto.map(nome => ({nome, origem: 'projeto'})),
    ...todos.filter(nome => !doProjeto.includes(nome)).map(nome => ({nome, origem: 'compartilhado'})),
  ].sort((a, b) => a.nome.localeCompare(b.nome)))
})

rotasDeProjetos.put('/projetos/:projetoId/segredos/:nome', async c => {
  const {projetoId, nome} = c.req.param()
  if (!NOME_DE_SEGREDO.test(nome)) return c.json({erro: 'Nome de segredo inválido (letras, números e _).'}, 400)
  const {valor} = await c.req.json<{valor?: string}>()
  if (typeof valor !== 'string' || !valor) return c.json({erro: 'Informe o valor.'}, 400)
  const conteudo = await lerArquivoDeSegredos()
  conteudo.projetos ??= {}
  conteudo.projetos[projetoId] = {...conteudo.projetos[projetoId], [nome]: valor}
  await Bun.write(ARQUIVO_DE_SEGREDOS, JSON.stringify(conteudo, null, 2))
  return c.json({ok: true})
})

rotasDeProjetos.delete('/projetos/:projetoId/segredos/:nome', async c => {
  const {projetoId, nome} = c.req.param()
  const conteudo = await lerArquivoDeSegredos()
  if (!conteudo.projetos?.[projetoId]?.[nome]) return c.json({erro: 'Só dá para apagar segredo do projeto (o compartilhado fica no arquivo).'}, 404)
  delete conteudo.projetos[projetoId][nome]
  await Bun.write(ARQUIVO_DE_SEGREDOS, JSON.stringify(conteudo, null, 2))
  return c.json({ok: true})
})

const pastaDoProjeto = (projetoId: string) => new URL(`${projetoId}/`, PASTA_DE_ARQUIVOS)

rotasDeProjetos.get('/projetos/:projetoId/arquivos', async c => {
  const pasta = pastaDoProjeto(c.req.param('projetoId'))
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return c.json([])
  }
  const arquivos = await Promise.all(nomes.map(async nome => {
    const info = await stat(new URL(encodeURIComponent(nome), pasta))
    return {nome, tamanho: info.size, atualizadoEm: info.mtime.toISOString()}
  }))
  return c.json(arquivos.sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm)))
})

/** Envio por multipart (campo "arquivo"); arquivo com o mesmo nome é substituído. */
rotasDeProjetos.post('/projetos/:projetoId/arquivos', async c => {
  const corpo = await c.req.parseBody()
  const arquivo = corpo.arquivo
  if (!(arquivo instanceof File)) return c.json({erro: 'Mande o arquivo no campo "arquivo".'}, 400)
  if (!nomeDeArquivoSeguro(arquivo.name)) return c.json({erro: 'Nome de arquivo inválido.'}, 400)
  const pasta = pastaDoProjeto(c.req.param('projetoId'))
  await mkdir(pasta, {recursive: true})
  await Bun.write(new URL(encodeURIComponent(arquivo.name), pasta), arquivo)
  return c.json({ok: true, nome: arquivo.name, tamanho: arquivo.size})
})

rotasDeProjetos.get('/projetos/:projetoId/arquivos/:nome', async c => {
  const nome = c.req.param('nome')
  if (!nomeDeArquivoSeguro(nome)) return c.json({erro: 'Nome de arquivo inválido.'}, 400)
  const arquivo = Bun.file(new URL(encodeURIComponent(nome), pastaDoProjeto(c.req.param('projetoId'))))
  if (!(await arquivo.exists())) return c.json({erro: 'Arquivo não encontrado.'}, 404)
  return new Response(arquivo, {headers: {'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`}})
})

rotasDeProjetos.delete('/projetos/:projetoId/arquivos/:nome', async c => {
  const nome = c.req.param('nome')
  if (!nomeDeArquivoSeguro(nome)) return c.json({erro: 'Nome de arquivo inválido.'}, 400)
  await rm(new URL(encodeURIComponent(nome), pastaDoProjeto(c.req.param('projetoId'))), {force: true})
  return c.json({ok: true})
})
