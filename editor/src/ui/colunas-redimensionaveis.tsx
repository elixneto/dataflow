import {useRef, useState, type PointerEvent, type RefObject} from 'react'

/**
 * Larguras (em fr, somando 100) das colunas de uma tabela que o usuário redimensiona arrastando a divisória do
 * cabeçalho. Ficam lembradas no navegador pela `chave`.
 */
export function useLargurasDasColunas(chave: string, padrao: number[]) {
  const [larguras, setLarguras] = useState<number[]>(() => {
    try {
      const salvas = JSON.parse(localStorage.getItem(chave) ?? 'null') as number[] | null
      if (Array.isArray(salvas) && salvas.length === padrao.length && salvas.every(n => typeof n === 'number' && n > 0)) return salvas
    } catch {
      // sem storage ou valor estragado: usa o padrão
    }
    return padrao
  })

  function lembrar(valor: number[]) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor.map(n => Math.round(n * 10) / 10)))
    } catch {
      // sem storage: vale só até recarregar
    }
  }

  return {larguras, setLarguras, lembrar, padrao}
}

const MINIMO = 10

/**
 * Divisória entre a coluna `indice` e a seguinte (fica na borda direita da célula do cabeçalho, que precisa ser
 * `relative`). Arrastar passa largura de uma para a outra; duplo clique volta ao padrão.
 */
export function Divisoria({indice, colunas, tabelaRef, larguraFixa = 0}: {
  indice: number
  colunas: ReturnType<typeof useLargurasDasColunas>
  tabelaRef: RefObject<HTMLElement | null>
  /** pixels das colunas que não redimensionam (setas, botões, espaços), para converter o arraste em fr */
  larguraFixa?: number
}) {
  const inicio = useRef<{x: number; larguras: number[]} | null>(null)

  function mover(e: PointerEvent<HTMLDivElement>) {
    const comeco = inicio.current
    const tabela = tabelaRef.current
    if (!comeco || !tabela) return
    const total = comeco.larguras.reduce((s, n) => s + n, 0)
    const largura = Math.max(tabela.getBoundingClientRect().width - larguraFixa, 1)
    const delta = ((e.clientX - comeco.x) / largura) * total
    const par = comeco.larguras[indice] + comeco.larguras[indice + 1]
    const esquerda = Math.min(Math.max(comeco.larguras[indice] + delta, MINIMO), par - MINIMO)
    colunas.setLarguras(comeco.larguras.map((n, i) => (i === indice ? esquerda : i === indice + 1 ? par - esquerda : n)))
  }

  function soltar() {
    if (!inicio.current) return
    inicio.current = null
    colunas.setLarguras(atual => {
      colunas.lembrar(atual)
      return atual
    })
  }

  return (
    <div role="separator" aria-orientation="vertical" aria-label="Redimensionar colunas" title="Arraste para redimensionar; duplo clique volta ao padrão"
         onPointerDown={e => {
           inicio.current = {x: e.clientX, larguras: colunas.larguras}
           e.currentTarget.setPointerCapture(e.pointerId)
         }}
         onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
         onDoubleClick={() => {
           colunas.setLarguras(colunas.padrao)
           colunas.lembrar(colunas.padrao)
         }}
         className="group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none justify-center">
      <span className="h-full w-px bg-border group-hover:w-0.5 group-hover:bg-primary"/>
    </div>
  )
}
