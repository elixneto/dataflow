import in_memory_pipeline from '#scenarios/in-memory-pipeline/scenario';
import flow_invoker_fanout from '#scenarios/flow-invoker-fanout/scenario';
import http_slow_api from '#scenarios/http-slow-api/scenario';
import mongodb_pipeline_aggregate from '#scenarios/mongodb-pipeline-aggregate/scenario';
import sqlserver_to_mongodb from '#scenarios/sqlserver-to-mongodb/scenario';
import type { Scenario } from '#perf/scenario';

export const SCENARIOS: Scenario[] = [
    in_memory_pipeline,
    flow_invoker_fanout,
    http_slow_api,
    mongodb_pipeline_aggregate,
    sqlserver_to_mongodb,
];
export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find(s => s.id === id);
