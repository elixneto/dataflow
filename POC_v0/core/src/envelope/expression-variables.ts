import type {Envelope} from '#types/envelope.type';

/**
 * Variables an expression sees in an envelope: the system ones and, directly, each DATA key.
 * E.g.: $PARAMETERS.prefix, $WORKFLOW_CURRENT_RUN.startedAt, $csvLine.NAME.
 */
export function envelopeVariables(doc: Envelope, secrets: Record<string, string> = {}): Record<string, unknown> {
  const variables: Record<string, unknown> = {
    $WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN,
    $PARAMETERS: doc.PARAMETERS,
    $SECRETS: secrets,
  };

  for (const [key, value] of Object.entries(doc.DATA)){
    variables[`$${key}`] = value;
  }

  return variables;
}
