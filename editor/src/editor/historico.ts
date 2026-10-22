import {createContext, useContext} from 'react'

type Historico = {
  /** guarda o estado atual para o Ctrl+Z (antes de uma mudança) */
  registrar: () => void
  /** mudanças seguidas no mesmo campo viram um passo só do Ctrl+Z */
  registrarEdicao: (chave: string) => void
}

export const HistoricoContext = createContext<Historico>({registrar: () => {}, registrarEdicao: () => {}})

export function useHistorico() {
  return useContext(HistoricoContext)
}
