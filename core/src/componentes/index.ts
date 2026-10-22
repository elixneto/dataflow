import type {ComponenteLogica} from '../tipos'
import {aggregate} from './aggregate'
import {copy} from './copy'
import {datagrid} from './datagrid'
import {filter} from './filter'
import {lookup} from './lookup'
import {mapper} from './mapper'
import {router} from './router'
import {sqlserver} from './sqlserver'
import {typescript} from './typescript'
import {unir} from './unir'
import {workflowInvoker} from './workflow'

/** Lógica de cada componente, por tipo. Componente novo = acrescentar aqui (e a parte visual no editor). */
export const COMPONENTES: Record<string, ComponenteLogica> = {
  [mapper.tipo]: mapper,
  [unir.tipo]: unir,
  [filter.tipo]: filter,
  [router.tipo]: router,
  [lookup.tipo]: lookup,
  [typescript.tipo]: typescript,
  [aggregate.tipo]: aggregate,
  [datagrid.tipo]: datagrid,
  [copy.tipo]: copy,
  [sqlserver.tipo]: sqlserver,
  [workflowInvoker.tipo]: workflowInvoker,
}
