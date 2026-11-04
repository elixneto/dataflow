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
