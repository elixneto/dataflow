import type {Envelope} from '#types/envelope.type';

/**
 * Variables an expression sees in an envelope: the system ones and, directly, each DATA key.
 * E.g.: $PARAMETERS.prefix, $FLOW_CURRENT_RUN.startedAt, $VARIABLES.region, $csvLine.NAME.
 */
export function envelopeVariables(doc: Envelope, secrets: Record<string, string> = {}, projectVariables: Record<string, string> = {}): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    $FLOW_CURRENT_RUN: doc.FLOW_CURRENT_RUN,
    $PARAMETERS: doc.PARAMETERS,
    $SECRETS: secrets,
    $VARIABLES: projectVariables,
  };

  for (const [key, value] of Object.entries(doc.DATA)){
    variables[`$${key}`] = value;
  }

  return variables;
}

/** the `$name`s an expression mentions that these variables do not have (fields missing from this envelope) */
export function missingFields(expression: string, variables: Record<string, unknown>): string[] {
  return [...new Set([...expression.matchAll(/\$[A-Za-z_][\w$]*/g)].map(([name]) => name))].filter(name => !(name in variables));
}

/**
 * The variables an expression is evaluated with: each `$name` it mentions that this envelope does not have is there,
 * undefined, so a field missing from some envelopes can be tested (`!$shipments ? 0 : $shipments.length`,
 * `$shipments ?? []`) instead of failing with "$shipments is not defined". Reading into it still fails (the runner
 * names the missing fields in that error).
 */
export function expressionScope(expression: string, variables: Record<string, unknown>): Record<string, unknown> {
  const scope = {...variables};
  for (const name of missingFields(expression, variables)) scope[name] = undefined;
  return scope;
}
