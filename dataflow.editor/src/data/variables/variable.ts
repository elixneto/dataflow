/*
 * A project's variables: like environment variables, plain values the flows read as ENV_VARIABLES['name'] (secrets
 * stay SECRETS['name']). The difference from a secret: a variable's value is not sensitive, so it is shown and can
 * be edited in place. Names follow the secrets' rule (@dataflow/core), unique among the project's variables.
 */

export { secretNameError as variableNameError, VARIABLE_VALUE_MAX as VALUE_MAX, variableValueError } from '@dataflow/core';

export type Variable = {
  id: string;
  projectId: string;
  name: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
};
