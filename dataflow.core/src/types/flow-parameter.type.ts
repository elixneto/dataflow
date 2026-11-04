import type {ParameterType} from '#types/parameter.type';

export type FlowParameter = {
  name: string;
  type: ParameterType;
  default: string;
  required?: boolean;
};
