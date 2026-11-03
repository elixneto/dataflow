/** Expression evaluator. Lives in the runner (node:vm sandbox); the core only receives the function. */
export type EvaluateExpression = (expression: string, variables: Record<string, unknown>) => unknown;
