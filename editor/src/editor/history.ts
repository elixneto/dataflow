import {createContext, useContext} from 'react'

type History = {
  /** saves the current state for Ctrl+Z (before a change) */
  record: () => void
  /** consecutive changes to the same field become a single Ctrl+Z step */
  recordEdit: (key: string) => void
}

export const HistoryContext = createContext<History>({record: () => {}, recordEdit: () => {}})

export function useHistory() {
  return useContext(HistoryContext)
}
