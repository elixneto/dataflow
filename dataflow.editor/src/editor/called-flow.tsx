import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Trash } from 'lucide-react';
import { inputTypeRef, shapeText, START, startConfig, type ExpressionField, type FlowParameter } from '@dataflow/core';
import { getDraft } from '@/data/flows/flows-api';
import { useTypeShape } from './typed-input';

/** a Flow Invoker's parameter as its config keeps it */
export type InvokerParameter = ExpressionField & { name: string };

/** what a Flow Invoker shows of the flow it calls: the Start of its draft (the published version, once there is one) */
export type CalledStart = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; acceptsInput: boolean; inputType: string; parameters: FlowParameter[] };

/** The Start of the called flow, read from its draft when the settings open and again when another flow is chosen. */
export function useCalledStart(flowId: string): CalledStart {
  // the Start read and the flow it is of: another flow chosen, loading until its own is read
  const [read, setRead] = useState<{ flowId: string; start: CalledStart } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void getDraft(flowId).then(draft => {
        if (!alive) {
          return;
        }

        if (!draft.ok) {
          setRead({ flowId, start: { status: 'missing' } });
          return;
        }

        const config = draft.value.flow.nodes.find(n => n.type === START)?.config ?? {};
        const { acceptsInput, parameters } = startConfig(config);
        const inputType = acceptsInput && typeof config.inputType === 'string' ? config.inputType : '';
        setRead({ flowId, start: { status: 'ready', acceptsInput, inputType, parameters } });
      });
    load();
    return () => {
      alive = false;
    };
  }, [flowId]);
  return read && read.flowId === flowId ? read.start : { status: 'loading' };
}

const isSet = (p: InvokerParameter | undefined) => !!p && (p.expression || p.value !== '');

/**
 * The parameters a Flow Invoker passes, one row per parameter of the called flow's Start (its type, Required, its
 * default as the placeholder): each one a fixed value or an expression, empty for the default. One the Start no longer
 * has stays listed, to be removed. Above them, the input that flow takes (its Start's type) and whether DATA goes to it.
 */
export function CalledFlowSetting(props: {
  id: string;
  start: Extract<CalledStart, { status: 'ready' }>;
  items: InvokerParameter[];
  sendEnvelope: boolean;
  /** the called flow calls this one back (directly or down the chain): the chain's names, this flow first and last */
  cycle?: string[];
  onChange: (items: InvokerParameter[]) => void;
  renderValue: (id: string, value: ExpressionField, placeholder: string, onChange: (value: ExpressionField) => void) => ReactNode;
}) {
  const { id, start, items, sendEnvelope, cycle, onChange, renderValue } = props;
  const known = new Set(start.parameters.map(p => p.name));
  const extra = items.filter(item => !known.has(item.name));
  const valueOf = (name: string) => items.find(item => item.name === name);
  // the Start's order, then the ones it no longer has; an empty fixed value is not kept (the default applies)
  const set = (name: string, value: ExpressionField) =>
    onChange(
      [...start.parameters.map(p => (p.name === name ? { name, ...value } : valueOf(p.name))), ...extra.map(item => (item.name === name ? { name, ...value } : item))].filter(
        (item): item is InvokerParameter => isSet(item),
      ),
    );

  return (
    <div className="grid gap-4">
      {cycle && (
        <Note warn>
          Circular call: {cycle.join(' → ')}. Each call would fail: break the chain there, or call another flow.
        </Note>
      )}
      <CalledInput inputType={start.inputType} acceptsInput={start.acceptsInput} sendEnvelope={sendEnvelope} />
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm leading-none font-medium">Parameters</legend>
        {start.parameters.length === 0 && extra.length === 0 && <p className="text-xs text-muted-foreground">The flow has no parameters.</p>}
        {start.parameters.map((p, index) => {
          const current = valueOf(p.name) ?? { name: p.name, value: '', expression: false };
          const missing = p.required && p.default === '' && !isSet(current);
          return (
            <div key={p.name} role="group" aria-label={`parameter ${p.name}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-1.5">
              <div className="grid min-h-8 min-w-0 content-center">
                <span className="truncate font-mono text-sm" title={p.name}>{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.type === 'boolean' ? 'yes/no' : p.type}
                  {p.required && (
                    <>
                      {' · '}
                      <span className={missing ? 'text-destructive' : undefined} title={missing ? 'Required, with no default: give it a value' : 'Required'}>
                        required
                      </span>
                    </>
                  )}
                </span>
              </div>
              {renderValue(`${id}-${index}`, current, p.default === '' ? '' : `default: ${p.default}`, value => set(p.name, value))}
            </div>
          );
        })}
        {extra.map(item => (
          <div key={item.name} role="group" aria-label={`parameter ${item.name}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-1.5">
            <span className="truncate font-mono text-sm text-muted-foreground line-through">{item.name}</span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-hidden />
              Not a parameter of this flow any more: it is ignored.
              <button
                type="button"
                aria-label={`Remove parameter ${item.name}`}
                title="Remove"
                className="ml-auto flex size-6 items-center justify-center rounded hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
                onClick={() => onChange(items.filter(i => i.name !== item.name))}
              >
                <Trash />
              </button>
            </div>
          </div>
        ))}
      </fieldset>
    </div>
  );
}

/** the input the called flow takes: its Start's type (as TypeScript), any JSON, or none; and what happens to DATA */
function CalledInput({ inputType, acceptsInput, sendEnvelope }: { inputType: string; acceptsInput: boolean; sendEnvelope: boolean }) {
  const { shape, loading } = useTypeShape(inputType);
  const ref = inputTypeRef(inputType);
  if (!acceptsInput) {
    return (
      <Note warn={sendEnvelope}>
        {sendEnvelope
          ? 'This flow takes no input (Accepts input is off in its Start): each call would fail. Turn off sending an input, or turn on Accepts input there.'
          : 'This flow takes no input: it starts with one empty envelope per call.'}
      </Note>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="text-sm leading-none font-medium">Expected input</div>
      {ref ? (
        <>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{ref.name}</span>, from the script <span className="font-mono">{ref.path}</span>
          </div>
          {shape ? (
            <pre className="max-h-32 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">{shapeText(shape)}</pre>
          ) : (
            !loading && <Note warn>The type {ref.name} no longer exists in that script: each call will fail.</Note>
          )}
          <p className="text-xs text-muted-foreground">
            {sendEnvelope
              ? 'Each envelope’s input is checked against it: one that does not fit goes to On error, and the flow does not run for it.'
              : 'No input is sent: the flow starts with no input.'}
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Any JSON (its Start has no input type).{sendEnvelope ? '' : ' No input is sent: the flow starts with no input.'}</p>
      )}
    </div>
  );
}

function Note({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <p className={warn ? 'flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500' : 'text-xs text-muted-foreground'}>
      {warn && <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />}
      {children}
    </p>
  );
}
