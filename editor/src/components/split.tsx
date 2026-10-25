import {Ungroup} from 'lucide-react';
import {split, splitList} from '@dataflow/core';
import {ExpressionBox} from '#ui/expression-field';
import type {FieldsProps} from '#types/fields-props.type';
import type {ComponentDef} from '#types/component-def.type';

// Visual part of the Split. The logic is the core's.

function SplitCard({config}: FieldsProps) {
  const list = splitList(config);
  if (!list.trim()) return <p className="text-xs italic text-muted-foreground">No list</p>;
  return <p className="truncate font-mono text-xs text-primary" title={list}>{list}</p>;
}

function SplitPanel({id, nodeId, config, setConfig}: FieldsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-list`} className="text-xs font-medium text-muted-foreground">List</label>
      <ExpressionBox id={`${id}-list`} nodeId={nodeId} value={splitList(config)} onValue={v => setConfig('list', v)}
                     placeholder="$items" label="List"/>
    </div>
  );
}

function SplitDocs() {
  return (
    <>
      <p>The opposite of Aggregate: takes a list from each envelope and yields one envelope per item, with the item as the whole <code>DATA</code>.</p>
      <pre>{`{items: [{id: 1, ...}, {id: 2, ...}]}  →  {id: 1, ...}, {id: 2, ...}`}</pre>
      <h4>Input</h4>
      <p>1 envelope port.</p>
      <h4>Output</h4>
      <p>1 envelope per item of the list, in order. An empty list yields nothing. The other fields of the incoming envelope are not carried over: to keep one, put it inside each item first (e.g. a TypeScript or a Mapper before).</p>
      <h4>List</h4>
      <p>A JS expression that must give a list of objects. <code>$PARAMETERS</code>, <code>$WORKFLOW_CURRENT_RUN</code> and each envelope field (<code>$field</code>) are available.</p>
      <p>E.g.: <code>$items</code> (what an Aggregate produces), <code>$order.lines</code>, <code>{'$rows.filter(r => r.active)'}</code>.</p>
      <h4>Disabled</h4>
      <p>The envelopes pass through without being split.</p>
      <h4>Errors</h4>
      <p>A value that is not a list, or a list with an item that is not an object, is an error of the envelope and follows the card's "On error" policy.</p>
    </>
  );
}

export const SPLIT: ComponentDef = {
  type: split.type,
  label: 'Split',
  description: 'Yields one envelope per item of a list',
  category: 'transformation',
  icon: Ungroup,
  inputs: split.inputs,
  outputs: split.outputs,
  defaultConfig: {list: '$items'},
  Card: SplitCard,
  Panel: SplitPanel,
  Docs: SplitDocs,
  validate: config => split.validate(config),
};
