import type {ComponentLogic} from '#types/component-logic.type';
import {aggregate} from './aggregate';
import {copy} from './copy';
import {datagrid} from './datagrid';
import {distinct} from './distinct';
import {filter} from './filter';
import {limit} from './limit';
import {log} from './log';
import {lookup} from './lookup';
import {mapper} from './mapper';
import {mongodbDelete} from './mongodb-delete';
import {mongodbPipeline} from './mongodb-pipeline';
import {mongodbUpsert} from './mongodb-upsert';
import {router} from './router';
import {split} from './split';
import {sort} from './sort';
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
  [sort.type]: sort,
  [limit.type]: limit,
  [datagrid.type]: datagrid,
  [copy.type]: copy,
  [sqlserver.type]: sqlserver,
  [mongodbPipeline.type]: mongodbPipeline,
  [mongodbUpsert.type]: mongodbUpsert,
  [mongodbDelete.type]: mongodbDelete,
  [workflowInvoker.type]: workflowInvoker,
  [log.type]: log,
};
