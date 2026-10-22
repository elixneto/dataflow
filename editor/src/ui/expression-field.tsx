import type {ClipboardEvent} from 'react';
import {cn} from '#lib/utils';

export const fieldInput =
  'nodrag h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * Field that can be plain text or an expression (the field's "="). Off, the value goes as is;
 * on, the runner evaluates it as JS: `$PARAMETERS.x`, `$WORKFLOW_CURRENT_RUN.startedAt`, `$envelopeKey.field`.
 */
export function ExpressionInput({value, expression, onValue, onExpression, placeholder, label}: {
  value: string;
  expression: boolean;
  onValue: (value: string) => void;
  onExpression: (on: boolean) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button type="button" onClick={() => onExpression(!expression)} aria-pressed={expression}
              title={expression ? 'Expression (JS): click to use plain text' : 'Plain text: click to use an expression (JS)'}
              className={cn('nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold transition-colors',
                expression ? 'border-primary bg-primary/15 text-primary' : 'border-input text-muted-foreground hover:text-foreground')}>
        =
      </button>
      <input value={value} onChange={e => onValue(e.target.value)} aria-label={label}
             placeholder={placeholder ?? (expression ? '$PARAMETERS.name' : 'text')}
             className={cn(fieldInput, expression && 'border-primary/50 bg-primary/5 font-mono')}/>
    </div>
  );
}

/** Field with the name of an envelope key: the "$" in front is a reminder of how it is read later ($key). */
export function KeyInput({value, onValue, onPaste, label, id, placeholder = 'key', className}: {
  value: string;
  onValue: (value: string) => void;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  label?: string;
  id?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">$</span>
      <input id={id} value={value} onChange={e => onValue(e.target.value)} onPaste={onPaste} placeholder={placeholder} aria-label={label}
             spellCheck={false} className={cn(fieldInput, 'font-mono')}/>
    </div>
  );
}
