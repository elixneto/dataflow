import {useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {expressionSyntaxError, unknownVariables, type AvailableVariable} from '@dataflow/core';
import {cn} from '#lib/utils';
import {useVariables} from '#editor/variables-context';

/** How many suggestions the list shows at once. */
const MAX_SUGGESTIONS = 50;

type Issue = {level: 'error' | 'warning'; message: string};
type Field = HTMLInputElement | HTMLTextAreaElement;

/** The `$...` being typed right before the cursor, if any. */
function tokenAt(text: string, cursor: number): {start: number; text: string} | null {
  const match = /\$[\w.]*$/.exec(text.slice(0, cursor));
  return match ? {start: cursor - match[0].length, text: match[0]} : null;
}

/** Problem with an expression: syntax (error) or a variable not seen at this node in the runs so far (warning). */
function issueOf(expression: string, variables: AvailableVariable[], seen: boolean): Issue | null {
  const syntax = expressionSyntaxError(expression);
  if (syntax) return {level: 'error', message: syntax};
  if (!seen) return null;
  const unknown = unknownVariables(expression, variables.map(v => v.path));
  return unknown.length ? {level: 'warning', message: `Not seen in the runs so far: ${unknown.join(', ')}`} : null;
}

export const fieldInput =
  'nodrag h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

const expressionStyle = 'border-primary/50 bg-primary/5 font-mono';

/**
 * Expression field (JS evaluated by the runner): typing `$` or `.` suggests the node's variables (what reached it in the
 * runs so far, parameters, secrets and the run), and leaving the field checks it: syntax (error) and unknown variables
 * (warning). `port` limits the suggestions to what arrives at that input (e.g. the Lookup's two sides).
 */
export function ExpressionBox({nodeId, port, value, onValue, label, placeholder, multiline, rows, id, className}: {
  /** node of the field: its variables are suggested */
  nodeId?: string;
  port?: string;
  value: string;
  onValue: (value: string) => void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  id?: string;
  className?: string;
}) {
  const field = useRef<Field>(null);
  const list = useRef<HTMLUListElement>(null);
  const {of, seen} = useVariables();
  const variables = nodeId ? of(nodeId, port) : [];
  const [token, setToken] = useState<{start: number; text: string} | null>(null);
  // the list goes to the body, fixed under the field: windows and tables would clip it
  const [place, setPlace] = useState<{top: number; left: number; width: number} | null>(null);
  const [active, setActive] = useState(0);
  const [issue, setIssue] = useState<Issue | null>(null);
  const suggestions = token
    ? variables.filter(v => v.path.toLowerCase().startsWith(token.text.toLowerCase()) && v.path !== token.text).slice(0, MAX_SUGGESTIONS)
    : [];

  // the keyboard moves the selection: the list follows it
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({block: 'nearest'});
  }, [active]);

  function follow(element: Field) {
    setToken(tokenAt(element.value, element.selectionStart ?? element.value.length));
    setActive(0);
    const box = element.getBoundingClientRect();
    setPlace({top: box.bottom + 4, left: box.left, width: box.width});
  }

  function insert(variable: AvailableVariable) {
    const element = field.current;
    if (!element || !token) return;
    const end = element.selectionStart ?? value.length;
    onValue(value.slice(0, token.start) + variable.path + value.slice(end));
    setToken(null);
    const cursor = token.start + variable.path.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(cursor, cursor);
    });
  }

  function onKeyDown(e: KeyboardEvent<Field>) {
    if (!suggestions.length) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive(i => (i + 1) % suggestions.length),
      ArrowUp: () => setActive(i => (i - 1 + suggestions.length) % suggestions.length),
      Enter: () => insert(suggestions[active]),
      Tab: () => insert(suggestions[active]),
      // closes only the list (not the window)
      Escape: () => setToken(null),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  }

  const props = {
    id, value, spellCheck: false, placeholder,
    'aria-label': label,
    onChange: (e: {target: Field}) => {
      onValue(e.target.value);
      setIssue(null);
      follow(e.target);
    },
    onClick: (e: {currentTarget: Field}) => follow(e.currentTarget),
    onKeyDown,
    onBlur: () => {
      setToken(null);
      setIssue(issueOf(value, variables, nodeId ? seen(nodeId, port) : false));
    },
    title: issue?.message,
    'aria-invalid': issue?.level === 'error' || undefined,
    role: 'combobox',
    'aria-expanded': suggestions.length > 0,
    className: cn(fieldInput, expressionStyle, multiline && 'h-auto resize-y py-1.5', className,
      issue?.level === 'error' && 'border-destructive bg-destructive/5',
      issue?.level === 'warning' && 'border-comment'),
  };

  return (
    <>
      {multiline
        ? <textarea ref={field as RefObject<HTMLTextAreaElement>} rows={rows} {...props}/>
        : <input ref={field as RefObject<HTMLInputElement>} {...props}/>}
      {suggestions.length > 0 && place && createPortal(
        <ul ref={list} role="listbox" aria-label="Variables" style={{top: place.top, left: place.left, minWidth: place.width}}
            className="nodrag nowheel fixed z-[1000] max-h-60 max-w-[480px] overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md">
          {suggestions.map((v, i) => (
            <li key={v.path} role="option" aria-selected={i === active} title={v.path}
                // mousedown (not click): the field must not lose the focus before inserting
                onMouseDown={e => {
                  e.preventDefault();
                  insert(v);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-baseline gap-2 rounded px-2 py-1', i === active && 'bg-accent')}>
              <span className="min-w-0 truncate font-mono">{v.path}</span>
              <span className="shrink-0 text-muted-foreground">{v.type}</span>
              {v.example && <span className="ml-auto min-w-0 truncate font-mono text-muted-foreground">{v.example}</span>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

/**
 * Field that can be plain text or an expression (the field's "="). Off, the value goes as is;
 * on, the runner evaluates it as JS: `$PARAMETERS.x`, `$WORKFLOW_CURRENT_RUN.startedAt`, `$envelopeKey.field`.
 */
export function ExpressionInput({nodeId, value, expression, onValue, onExpression, placeholder, label}: {
  /** node of the field: its variables are suggested */
  nodeId?: string;
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
      {expression
        ? <ExpressionBox nodeId={nodeId} value={value} onValue={onValue} label={label} placeholder={placeholder ?? '$PARAMETERS.name'}/>
        : <input value={value} onChange={e => onValue(e.target.value)} aria-label={label} placeholder={placeholder ?? 'text'} className={fieldInput}/>}
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
