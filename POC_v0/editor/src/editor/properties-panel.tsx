import {useState} from 'react';
import {CircleAlert} from 'lucide-react';
import {BY_TYPE} from '#components/catalog';
import {cn} from '#lib/utils';
import type {ComponentData, ComponentNode} from '#editor/component-node';

type Tab = 'configuration' | 'notes';

type Props = {
  node: ComponentNode;
  receivesRows: boolean;
  onLabel: (id: string, label: string) => void;
  onData: (id: string, update: Partial<Pick<ComponentData, 'outputKey' | 'override' | 'notes'>>) => void;
  onConfig: (id: string, key: string, value: unknown) => void;
};

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/** Body of a component's window: the Configuration tab and the Notes tab (free notes + the component's docs). */
export function PropertiesPanel({node, receivesRows, onLabel, onData, onConfig}: Props) {
  const [tab, setTab] = useState<Tab>('configuration');
  const def = BY_TYPE[node.data.type];
  const Content = def.Panel ?? def.Card;
  const Docs = def.Docs;
  const issues = def.validate?.(node.data.config, {receivesRows}) ?? [];

  return (
    <>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-sidebar-border px-3">
        {([['configuration', 'Configuration'], ['notes', 'Notes']] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                  className={cn('-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                    tab === value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {label}
            {value === 'notes' && node.data.notes?.trim() && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-comment align-middle" aria-label="has a note"/>}
          </button>
        ))}
      </div>

      {tab === 'configuration' ? (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-4 [&>*]:shrink-0">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${node.id}-label`} className="text-xs font-medium text-muted-foreground">Label</label>
            <input id={`${node.id}-label`} value={node.data.label} onChange={e => onLabel(node.id, e.target.value)} className={inputClass}/>
          </div>

          {def.defaultOutputKey && !node.data.override && (
            <div className="flex flex-col gap-2">
              <label htmlFor={`${node.id}-key`} className="text-xs font-medium text-muted-foreground">Key in the envelope</label>
              <div className="flex items-center gap-1">
                <span className="font-mono text-sm text-muted-foreground">$</span>
                <input id={`${node.id}-key`} value={node.data.outputKey ?? ''} onChange={e => onData(node.id, {outputKey: e.target.value})}
                       placeholder={def.defaultOutputKey} className={`${inputClass} font-mono`}/>
              </div>
            </div>
          )}

          {def.usesOverride && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={node.data.override ?? false} onChange={e => onData(node.id, {override: e.target.checked})} className="size-4"/>
              Override
            </label>
          )}

          {issues.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive" aria-label="Issues">
              {issues.map(p => (
                <li key={p} className="flex gap-2"><CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true"/><span>{p.charAt(0).toUpperCase() + p.slice(1)}</span></li>
              ))}
            </ul>
          )}

          {Content && <Content id={`panel-${node.id}`} nodeId={node.id} config={node.data.config} setConfig={(k, v) => onConfig(node.id, k, v)} receivesRows={receivesRows}/>}
        </div>
      ) : (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 [&>*]:shrink-0">
          <div className="flex flex-col gap-2">
            <label htmlFor={`${node.id}-notes`} className="text-xs font-medium text-muted-foreground">Notes</label>
            <textarea id={`${node.id}-notes`} value={node.data.notes ?? ''} onChange={e => onData(node.id, {notes: e.target.value})}
                      placeholder="Notes"
                      className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"/>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground [&_code]:font-mono [&_code]:text-foreground [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-4 [&_h4]:mt-2 [&_h4]:text-xs [&_h4]:font-medium [&_h4]:uppercase [&_h4]:tracking-wider">
            {Docs ? <Docs/> : <p>{def.description}</p>}
          </div>
        </div>
      )}
    </>
  );
}
