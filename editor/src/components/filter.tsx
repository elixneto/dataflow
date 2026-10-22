import {Funnel} from 'lucide-react';
import {filterCondition, filter} from '@dataflow/core';
import {fieldInput} from '#ui/expression-field';
import {cn} from '#lib/utils';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Filter. The logic (validate and execute) is the core's.

function FilterCard({config}: FieldsProps) {
  const condition = filterCondition(config);
  if (!condition.trim()) return <p className="text-xs italic text-muted-foreground">No condition</p>;
  return <p className="truncate font-mono text-xs text-primary" title={condition}>{condition}</p>;
}

function FilterPanel({id, config, setConfig}: FieldsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-condition`} className="text-xs font-medium text-muted-foreground">Condition</label>
      <textarea id={`${id}-condition`} value={filterCondition(config)} onChange={e => setConfig('condition', e.target.value)}
                rows={3} placeholder="$price > 10" spellCheck={false}
                className={cn(fieldInput, 'h-auto resize-y border-primary/50 bg-primary/5 py-1.5 font-mono')}/>
    </div>
  );
}

function FilterDocs() {
  return (
    <>
      <p>Evaluates a condition for each envelope and sends the envelope to the <code>true</code> or <code>false</code> output. Does not touch <code>DATA</code>.</p>
      <h4>Input</h4>
      <p>1 envelope port.</p>
      <h4>Outputs</h4>
      <p><code>true</code> (top): envelopes where the condition was true. <code>false</code> (bottom): the rest. The <code>false</code> one may stay unconnected: what goes out through it is dropped.</p>
      <h4>Condition</h4>
      <p>A JS expression. <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> and each envelope field (<code>$field</code>) are available.</p>
      <p>E.g.: <code>{'$price > 10'}</code>, <code>{'$status === "ACTIVE" && $email'}</code>, <code>{'$name.startsWith("A")'}</code>.</p>
      <p>JS rules apply: <code>0</code>, <code>{'""'}</code>, <code>null</code> and <code>undefined</code> count as false.</p>
      <h4>Disabled</h4>
      <p>Every envelope goes out through <code>true</code>.</p>
      <h4>Errors</h4>
      <p>A condition that fails (e.g. <code>$doesNotExist.field</code>) is an error of the envelope and follows the card's "On error" policy.</p>
    </>
  );
}

export const FILTER: ComponentDef = {
  type: filter.type,
  label: 'Filter',
  description: 'Splits the envelopes into true and false',
  category: 'transformation',
  icon: Funnel,
  inputs: filter.inputs,
  outputs: filter.outputs,
  outputLabels: ['true', 'false'],
  optionalOutputs: filter.optionalOutputs,
  defaultConfig: {condition: ''},
  Card: FilterCard,
  Panel: FilterPanel,
  Docs: FilterDocs,
  validate: config => filter.validate(config),
};
