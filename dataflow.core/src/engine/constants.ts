export const START = 'start';
export const END = 'end';

/** How many envelopes to keep per port in the run sample. */
export const SAMPLE_SIZE = 50;

/** How many workflows can call each other in sequence (A calls B which calls C...). */
export const MAX_WORKFLOW_DEPTH = 10;

/** How many sub-runs to keep in the component's record. */
export const MAX_SUB_RUNS = 50;

/** How many envelopes to measure at the start to estimate the size; after that, one every MEASURE_INTERVAL. */
export const INITIAL_MEASURES = 50;
export const MEASURE_INTERVAL = 100;
