import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { expressionSyntaxError, unknownVariables, type AvailableVariable } from '@dataflow/core';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { suggestionsFor, tokenAt, useExpressionVariables } from './expression-variables';

type Issue = { level: 'error' | 'warning'; message: string };

/** a problem with an expression: syntax (error) or a variable not seen at this node in the runs so far (warning) */
function issueOf(expression: string, variables: AvailableVariable[], seen: boolean): Issue | null {
  const syntax = expressionSyntaxError(expression);
  if (syntax) {
    return { level: 'error', message: syntax };
  }

  if (!seen) {
    return null;
  }

  const unknown = unknownVariables(expression, variables.map(v => v.path));
  return unknown.length ? { level: 'warning', message: `Not seen in the runs so far: ${unknown.join(', ')}` } : null;
}

/**
 * An expression field, as in the PoC: typing `$` or `.` suggests the component's variables (what reached it in the
 * runs so far, the parameters, the project's variables and secrets by name, the run), with their type and a sample;
 * arrows move, Enter or Tab insert, Esc closes the list. Leaving the field checks it: syntax (error), a variable not
 * seen in the runs (warning).
 */
export function ExpressionBox(props: { id: string; nodeId?: string; value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  const { id, nodeId, value, onChange, placeholder, className } = props;
  const field = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const { of, seen } = useExpressionVariables();
  const variables = nodeId ? of(nodeId) : [];
  const [token, setToken] = useState<{ start: number; text: string } | null>(null);
  // the list goes to the body, fixed under the field: the window would clip it
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const [active, setActive] = useState(0);
  const [issue, setIssue] = useState<Issue | null>(null);
  const suggestions = token ? suggestionsFor(variables, token.text) : [];

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const follow = (element: HTMLTextAreaElement) => {
    setToken(tokenAt(element.value, element.selectionStart ?? element.value.length));
    setActive(0);
    const box = element.getBoundingClientRect();
    setPlace({ top: box.bottom + 4, left: box.left, width: box.width });
  };

  const insert = (variable: AvailableVariable) => {
    const element = field.current;
    if (!element || !token) {
      return;
    }

    const end = element.selectionStart ?? value.length;
    onChange(value.slice(0, token.start) + variable.path + value.slice(end));
    setToken(null);
    const cursor = token.start + variable.path.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(cursor, cursor);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.length) {
      return;
    }

    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive(i => (i + 1) % suggestions.length),
      ArrowUp: () => setActive(i => (i - 1 + suggestions.length) % suggestions.length),
      Enter: () => insert(suggestions[active]!),
      Tab: () => insert(suggestions[active]!),
      // closes only the list (not the window)
      Escape: () => setToken(null),
    };
    const action = keys[event.key];
    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <>
      <Textarea
        ref={field}
        id={id}
        value={value}
        rows={1}
        placeholder={placeholder}
        spellCheck={false}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-invalid={issue?.level === 'error' || undefined}
        title={issue?.message}
        className={cn('min-h-8 py-1.5 font-mono', issue?.level === 'warning' && 'border-amber-500/70', className)}
        onChange={event => {
          onChange(event.target.value);
          setIssue(null);
          follow(event.target);
        }}
        onClick={event => follow(event.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setToken(null);
          setIssue(issueOf(value, variables, nodeId ? seen(nodeId) : false));
        }}
      />
      {issue && <p className={cn('text-xs', issue.level === 'error' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')}>{issue.message}</p>}
      {suggestions.length > 0 &&
        place &&
        createPortal(
          <ul
            ref={list}
            role="listbox"
            aria-label="Variables"
            style={{ top: place.top, left: place.left, minWidth: place.width }}
            className="nodrag nowheel fixed z-[1000] max-h-60 max-w-[480px] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          >
            {suggestions.map((v, i) => (
              <li
                key={v.path}
                role="option"
                aria-selected={i === active}
                title={v.path}
                // mousedown (not click): the field keeps the focus until it is inserted
                onMouseDown={event => {
                  event.preventDefault();
                  insert(v);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-baseline gap-2 rounded px-2 py-1', i === active && 'bg-accent')}
              >
                <span className="min-w-0 truncate font-mono">{v.path}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{v.type}</span>
                {v.example && <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground">{v.example}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
