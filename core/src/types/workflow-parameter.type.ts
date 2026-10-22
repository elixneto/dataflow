import type {ParameterType} from '#types/parameter.type';

export type WorkflowParameter = {
  name: string;
  type: ParameterType;
  default: string;
  required?: boolean;
};
