import type {ClipboardEvent} from 'react'
import {cn} from '@/lib/utils'

export const inputCampo =
  'nodrag h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30'

/**
 * Campo que pode ser texto puro ou expression (o "=" do campo). Desligado, o valor vai como está;
 * ligado, o runner avalia em JS: `$PARAMETERS.x`, `$WORKFLOW_CURRENT_RUN.startedAt`, `$chaveDoEnvelope.campo`.
 */
export function CampoExpression({valor, expression, onValor, onExpression, placeholder, rotulo}: {
  valor: string
  expression: boolean
  onValor: (valor: string) => void
  onExpression: (ligado: boolean) => void
  placeholder?: string
  rotulo: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button type="button" onClick={() => onExpression(!expression)} aria-pressed={expression}
              title={expression ? 'Expression (JS): clique para usar texto puro' : 'Texto puro: clique para usar expression (JS)'}
              className={cn('nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold transition-colors',
                expression ? 'border-primary bg-primary/15 text-primary' : 'border-input text-muted-foreground hover:text-foreground')}>
        =
      </button>
      <input value={valor} onChange={e => onValor(e.target.value)} aria-label={rotulo}
             placeholder={placeholder ?? (expression ? '$PARAMETERS.nome' : 'texto')}
             className={cn(inputCampo, expression && 'border-primary/50 bg-primary/5 font-mono')}/>
    </div>
  )
}

/** Campo com o nome de uma chave do envelope: o "$" na frente lembra como ela é lida depois ($chave). */
export function CampoDaChave({valor, onValor, onPaste, rotulo, id, placeholder = 'chave', className}: {
  valor: string
  onValor: (valor: string) => void
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void
  rotulo?: string
  id?: string
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$</span>
      <input id={id} value={valor} onChange={e => onValor(e.target.value)} onPaste={onPaste} placeholder={placeholder} aria-label={rotulo}
             spellCheck={false} className={cn(inputCampo, 'font-mono')}/>
    </div>
  )
}
