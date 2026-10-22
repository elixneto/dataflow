import {useEffect} from 'react'

const MENSAGEM_BENIGNA = 'ResizeObserver loop'

type ResizeObserverComPatch = typeof ResizeObserver & {__rafPatched?: boolean}

// O React Flow mede cada nó com ResizeObserver. Quando um nó cresce durante a medição (ex.: esticar um comentário),
// o navegador avisa "ResizeObserver loop completed". Adiar o callback para o próximo frame quebra esse ciclo.
// Roda no carregamento do módulo, antes do React Flow criar os observers.
function aplicarPatch() {
  if (typeof window === 'undefined') return
  const Nativo = window.ResizeObserver as ResizeObserverComPatch | undefined
  if (!Nativo || Nativo.__rafPatched) return

  class RafResizeObserver extends Nativo {
    constructor(callback: ResizeObserverCallback) {
      let frame = 0
      super((entries, observer) => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => callback(entries, observer))
      })
    }
  }
  ;(RafResizeObserver as ResizeObserverComPatch).__rafPatched = true
  window.ResizeObserver = RafResizeObserver
}

aplicarPatch()

export function ResizeObserverGuard() {
  useEffect(() => {
    function aoErro(event: ErrorEvent) {
      if (event.message?.includes(MENSAGEM_BENIGNA)) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }
    window.addEventListener('error', aoErro, {capture: true})
    return () => window.removeEventListener('error', aoErro, {capture: true})
  }, [])
  return null
}
