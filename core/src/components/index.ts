import type {ComponentLogic} from '#types/component-logic.type';
import {aggregate} from './aggregate';
import {copy} from './copy';
import {datagrid} from './datagrid';
import {distinct} from './distinct';
import {filter} from './filter';
import {lookup} from './lookup';
import {mapper} from './mapper';
import {router} from './router';
import {split} from './split';
import {sqlserver} from './sqlserver';
import {typescript} from './typescript';
import {union} from './union';
import {workflowInvoker} from './workflow';

/** Logic of each component, by type. New component = add it here (and its visual part in the editor). */
export const COMPONENTS: Record<string, ComponentLogic> = {
  [mapper.type]: mapper,
  [union.type]: union,
  [filter.type]: filter,
  [router.type]: router,
  [lookup.type]: lookup,
  [typescript.type]: typescript,
  [aggregate.type]: aggregate,
  [split.type]: split,
  [distinct.type]: distinct,
  [datagrid.type]: datagrid,
  [copy.type]: copy,
  [sqlserver.type]: sqlserver,
  [workflowInvoker.type]: workflowInvoker,
};
