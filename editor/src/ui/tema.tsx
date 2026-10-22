import {useState} from 'react'
import {Moon, Sun} from 'lucide-react'
import {Button} from './button'

const CHAVE = 'dataflow-fluxos-tema'

function lerTema(): 'dark' | 'light' {
  try {
    return localStorage.getItem(CHAVE) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Aplica o tema salvo antes do primeiro render (o padrão é escuro, como no v0). */
export function aplicarTemaSalvo() {
  document.documentElement.classList.toggle('dark', lerTema() === 'dark')
}

export function BotaoTema() {
  const [tema, setTema] = useState(lerTema)
  function alternar() {
    const proximo = tema === 'dark' ? 'light' : 'dark'
    setTema(proximo)
    document.documentElement.classList.toggle('dark', proximo === 'dark')
    try {
      localStorage.setItem(CHAVE, proximo)
    } catch {
      // sem storage: vale só até recarregar
    }
  }
  return (
    <Button variant="ghost" size="icon-sm" onClick={alternar} aria-label={tema === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            title={tema === 'dark' ? 'Tema claro' : 'Tema escuro'}>
      {tema === 'dark' ? <Sun className="size-4" aria-hidden="true"/> : <Moon className="size-4" aria-hidden="true"/>}
    </Button>
  )
}
