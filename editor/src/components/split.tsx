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
      <p>Takes a list from each envelope and yields one envelope per item: the opposite of Aggregate.</p>
      <ul>
        <li>List: an expression that gives a list of objects, e.g. <code>$items</code>, <code>$response.body.data</code>.</li>
        <li>Each item becomes the whole <code>DATA</code>: the other fields are not carried over.</li>
        <li>Not a list (or an item that is not an object): an error of the envelope.</li>
      </ul>
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
