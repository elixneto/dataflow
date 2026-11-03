import {Funnel} from 'lucide-react';
import {filterCondition, filter} from '@dataflow/core';
import {ExpressionBox} from '#ui/expression-field';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Filter. The logic (validate and execute) is the core's.

function FilterCard({config}: FieldsProps) {
  const condition = filterCondition(config);
  if (!condition.trim()) return <p className="text-xs italic text-muted-foreground">No condition</p>;
  return <p className="truncate font-mono text-xs text-primary" title={condition}>{condition}</p>;
}

function FilterPanel({id, nodeId, config, setConfig}: FieldsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-condition`} className="text-xs font-medium text-muted-foreground">Condition</label>
      <ExpressionBox id={`${id}-condition`} nodeId={nodeId} value={filterCondition(config)} onValue={v => setConfig('condition', v)}
                     multiline rows={3} placeholder="$price > 10" label="Condition"/>
    </div>
  );
}

function FilterDocs() {
  return (
    <>
      <p>Sends each envelope to <code>true</code> or <code>false</code> by a condition. Does not touch <code>DATA</code>.</p>
      <ul>
        <li>Condition: a JS expression, e.g. <code>{'$price > 10 && $status === "ACTIVE"'}</code>.</li>
        <li>JS rules: <code>0</code>, <code>{'""'}</code> and <code>null</code> are false.</li>
        <li><code>false</code> may stay unconnected: its envelopes are dropped.</li>
      </ul>
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
